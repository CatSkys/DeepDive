// 会话事件面 hook（R-007 从 SessionView 搬出）：事件日志全量缓存 + 增量摄取、
// session/follow 直播流（0.1.2：开窗快照 + 之后追加事件，断线重连重发快照）、
// session/page 深历史分页、plan/goal 投影（control 流实时 + 3s 轮询兜底）、
// schedule 折叠。不管渲染与滚动 UI（分页锚定经 refs 参数借用组件的滚动容器）。
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { api } from "../api";
import { useStore } from "../store";
import type { SessionAddress, SessionEvent } from "../types";
import { finalizeTurns, foldSchedule, ingest, makeIngestCtx, type IngestCtx, type RenderItem } from "./renderModel";

export function useSessionEvents(
  sessionId: string,
  refs: { scrollRef: RefObject<HTMLDivElement | null>; olderAnchorRef: RefObject<HTMLElement | null> },
) {
  const store = useStore();
  const [items, setItems] = useState<RenderItem[]>([]);
  // items 的同步镜像：流式增量摄取直接在最新列表上做（副作用不进 setState
  // updater——StrictMode dev 下 updater 双调用，AUD-084 之前靠 seq 守卫兜住，
  // 现在结构上杜绝：handler 内完成 log.push/ingest/finalize，再一次性快照）。
  const itemsRef = useRef<RenderItem[]>([]);
  itemsRef.current = items;
  // 开窗失败不再静默（AUD-050）：非 blank 会话渲染成空白流会让用户以为会话
  // 被清空；retry 经 retryKey 重跑整个挂载 effect。
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  // Live turn state from follow events; `summary.running` (store poll) covers
  // reload mid-turn, where no turn/start will ever arrive again.
  const [liveRunning, setLiveRunning] = useState(false);
  const [runningSince, setRunningSince] = useState<number | undefined>(undefined);
  const [plan, setPlan] = useState<{ active: boolean; pending: boolean } | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // 已加载窗口最早事件 seq（分页游标）：state 无渲染读者，ref 即事实源，
  // loadOlder/loadThrough 循环里同步读现值。
  const earliestSeqRef = useRef<number | undefined>(undefined);
  // 深跳互斥：一次跳转进行中忽略新的跳转/载入更早点击。
  const pagingRef = useRef(false);
  /** turnOutline 投影（开窗快照种子 + control projection 帧实时整值）。 */
  const [outline, setOutline] = useState<import("../types").TurnOutlineEntry[]>([]);
  // 5.1 Goal：goal 投影整值（control projection 实时推，3s 轮询兜底）
  const [goalProj, setGoalProj] = useState<import("../types").GoalProjection | null | undefined>(undefined);
  const refreshGoal = () => {
    void api.sessions().then((r) => {
      const s = (r.items ?? []).find((x) => x.sessionId === sessionId);
      const v = s?.projections?.values?.goal as import("../types").GoalProjection | null | undefined;
      setGoalProj(v ?? null);
    }).catch(() => void 0); // goal 投影轮询兜底：单次失败等实时推送或下一拍
  };
  // 5.3 Schedule：schedule/change 折叠出的会话提醒目录（只读）
  const [scheduleRecords, setScheduleRecords] = useState<import("../types").ScheduleRecord[]>([]);

  // Turn-level aggregations + stable-id indexes, shared by the history replay
  // and live follow passes so the derivations stay identical.
  const ctx = useRef<IngestCtx>(makeIngestCtx());

  // Full event log (ascending seq) backing this session. The follow opening
  // snapshot seeds it; older pages prepend on "载入更早"; live events append.
  // Every render rebuilds `items` from the whole log so ordering/dedup is
  // deterministic — the official append-only log + derived UI model.
  const eventLog = useRef<import("../types").HistoryEntry[]>([]);
  /** follow 开窗帧的 cursor：session/page 向前翻页的必填 throughSeq。 */
  const throughSeqRef = useRef<number | undefined>(undefined);
  /** 已解析的会话地址（subagent 子会话翻页也要用同一地址）。 */
  const addressRef = useRef<SessionAddress>({ kind: "session", sessionId });

  /** Rebuild rendered items from the full asc event log + ctx. */
  const rebuild = useMemo(() => (entries: import("../types").HistoryEntry[]) => {
    const rendered: RenderItem[] = [];
    ctx.current = makeIngestCtx();
    for (const entry of entries) {
      ingest(rendered, entry, ctx.current);
    }
    finalizeTurns(rendered, ctx.current);
    return rendered;
  }, []);

  /** 折叠整份日志里的 schedule/change（历史窗 + 增量共用）。 */
  const foldScheduleAll = (entries: import("../types").HistoryEntry[]): import("../types").ScheduleRecord[] => {
    let recs: import("../types").ScheduleRecord[] = [];
    for (const e of entries) {
      if (e.event.type === "schedule/change") {
        recs = foldSchedule(recs, e.event.data as import("../types").ScheduleChangeData);
      }
    }
    return recs;
  };

  useEffect(() => {
    let alive = true;
    let seqFloor = -1;
    eventLog.current = [];
    itemsRef.current = [];
    ctx.current = makeIngestCtx();
    setItems([]);
    setLoadError(false);
    setLiveRunning(false);
    setHasMore(false);
    earliestSeqRef.current = undefined;
    setOutline([]);

    // 0.1.2 engine surface (PITFALLS §4.6)：冷读+直播统一走 session/follow 流
    // ——开窗帧给 {cursor, records, hasMore}，此后同流追加事件；向前翻页走
    // session/page（throughSeq 必须取自开窗 cursor）。子会话（origin==='subagent'）
    // 用 subagent 地址（mode 经 subagents/list 查证，缺省 continuable）。
    const resolveAddress = async (): Promise<SessionAddress> => {
      const sum = store.sessions.find((x) => x.sessionId === sessionId);
      if (sum?.origin !== "subagent" || !sum.parentSessionId) return { kind: "session", sessionId };
      const parentSessionId = sum.parentSessionId;
      try {
        const list = await api.subagentList({ parentSessionId });
        const self = list.entries.find((e): e is Extract<import("../types").SubagentListEntry, { kind: "child" }> => e.kind === "child" && e.id === sessionId);
        return { kind: "subagent", parentSessionId, childSessionId: sessionId, mode: self?.mode ?? "continuable" };
      } catch { /* 引擎侧父目录不可用：按 continuable 地址直试 */ }
      return { kind: "subagent", parentSessionId, childSessionId: sessionId, mode: "continuable" };
    };

    let closeFollow: (() => void) | undefined;
    void resolveAddress().then((address) => {
      if (!alive) return;
      addressRef.current = address;
      closeFollow = api.followSession(address, {
        onSnapshot: (s) => {
          if (!alive) return;
          // 开窗（含断线重连重发）= 全量替换：log/ctx/items 一并重建。
          eventLog.current = s.entries;
          const next = rebuild(eventLog.current);
          itemsRef.current = next;
          setItems(next);
          setHasMore(s.hasMore);
          throughSeqRef.current = s.cursor;
          setScheduleRecords(foldScheduleAll(eventLog.current));
          const first = s.entries[0];
          earliestSeqRef.current = first ? first.event.seq : undefined;
          const outlineVal = s.projections.values?.turnOutline as import("../types").TurnOutlineEntry[] | undefined;
          setOutline(Array.isArray(outlineVal) ? outlineVal : []);
          const last = s.entries[s.entries.length - 1];
          seqFloor = last ? last.event.seq + 1 : 0;
          const goalVal = s.projections.values?.goal as import("../types").GoalProjection | undefined;
          setGoalProj(goalVal ?? null);
          setLoadError(false);
        },
        onEvent: (ev: SessionEvent) => {
          if (!alive) return;
          if (ev.type === "schedule/change") {
            setScheduleRecords((prev) => foldSchedule(prev, ev.data as import("../types").ScheduleChangeData));
          }
          const seq = ev.seq ?? -1;
          if (seq >= 0 && seq < seqFloor) return;
          const log = eventLog.current;
          if (seq >= 0 && log.length && seq <= log[log.length - 1]!.event.seq) return;
          // 增量摄取：流式期间每条增量只 ingest 新事件（append-only，seq 严格递增
          // 已由上方双守卫保证），不再对整份 event log 做全量重建 —— 长会话流式
          // 卡顿的主要来源。turn/end 时重插 turn-tail；历史页加载/载入更早仍走
          // 全量 rebuild（前插需要重排序）。副作用（log/ingest/finalize）全部在
          // handler 内完成，setState 只收快照（AUD-084：updater 必须纯函数）。
          log.push({ event: ev });
          ingest(itemsRef.current, { event: ev }, ctx.current);
          if (ev.type === "turn/end") finalizeTurns(itemsRef.current, ctx.current);
          setItems(itemsRef.current.slice());
          if (ev.type === "turn/start") {
            setLiveRunning(true);
            setRunningSince(ev.time);
          } else if (ev.type === "turn/end") {
            setLiveRunning(false);
            setRunningSince(undefined);
          }
          if (seq >= 0) seqFloor = seq + 1;
        },
      }, 120);
      // 开窗迟迟未到（引擎重启/断连循环）：短延时后显式失败态（AUD-050）。
      window.setTimeout(() => {
        if (alive && throughSeqRef.current === undefined) setLoadError(true);
      }, 4000);
    }).catch(() => {
      if (alive) setLoadError(true);
    });

    // plan projection: DSH PlanChip visibility (active, or pending when folded)
    // + goal 投影兜底（正常路径走 control projection 实时推送）。
    // plan 键只在有值时 setPlan 是安全的：引擎侧 plan 投影是常驻纯折叠
    // （vendored plan-mode/src/index.ts——init 恒有值、view 派生 {active,
    // pending}、键不从 projections.values 移除），无值只可能出现在「引擎
    // 无 plan 面」的首次读，那时芯片本就从未显示过（AUD-073 查证结论）。
    const tickPlan = () => {
      api.sessions().then((r) => {
        const s = (r.items ?? []).find((x) => x.sessionId === sessionId);
        const planVal = s?.projections?.values?.plan as { active?: boolean; pending?: boolean } | undefined;
        if (planVal) {
          setPlan({ active: !!planVal.active, pending: !!planVal.pending });
        }
        const goalVal = s?.projections?.values?.goal as import("../types").GoalProjection | null | undefined;
        setGoalProj(goalVal ?? null);
      }).catch(() => void 0); // 3s 轮询兜底：单次失败等下一拍
    };
    tickPlan();
    const planIv = setInterval(tickPlan, 3000);

    return () => {
      alive = false;
      clearInterval(planIv);
      closeFollow?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, retryKey]);

  // control 流投影（goal/turnOutline 实时整值；plan 同键路）。
  useEffect(() => {
    return store.subscribeControl((frame) => {
      if (frame.type !== "projection" || frame.sessionId !== sessionId) return;
      if (frame.key === "goal") {
        setGoalProj((frame.value ?? null) as import("../types").GoalProjection | null);
      } else if (frame.key === "turnOutline") {
        setOutline(Array.isArray(frame.value) ? frame.value as import("../types").TurnOutlineEntry[] : []);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  /** 向前翻一页并把新页并入日志（载入更早/大纲跳转共用）；返回新页首 seq。 */
  const pageOnce = async (maxMessages: number): Promise<{ firstSeq?: number; hasMore: boolean }> => {
    const beforeSeq = earliestSeqRef.current;
    const throughSeq = throughSeqRef.current;
    if (beforeSeq === undefined || throughSeq === undefined) return { hasMore: false };
    // Capture the scrollport position of the current first row so we can
    // keep it visually pinned after older rows are prepended.
    const el = refs.olderAnchorRef.current;
    const anchorTop = el ? el.getBoundingClientRect().top - refs.scrollRef.current!.getBoundingClientRect().top : 0;
    const { entries: older, hasMore: more } = await api.page({
      address: addressRef.current, throughSeq, beforeSeq, maxMessages,
    });
    eventLog.current = [...older, ...eventLog.current];
    setScheduleRecords(foldScheduleAll(eventLog.current));
    const next = rebuild(eventLog.current);
    itemsRef.current = next;
    setItems(next);
    // After render, restore the anchor row to its captured offset.
    requestAnimationFrame(() => {
      const sc = refs.scrollRef.current;
      const a = refs.olderAnchorRef.current;
      if (sc && a) {
        const delta = a.getBoundingClientRect().top - sc.getBoundingClientRect().top - anchorTop;
        sc.scrollTop += delta;
      }
    });
    setHasMore(more);
    const first = older[0] as { event?: { seq?: number } } | undefined;
    const firstSeq = first?.event?.seq;
    if (firstSeq !== undefined) earliestSeqRef.current = firstSeq;
    return { firstSeq, hasMore: more };
  };

  const loadOlder = async () => {
    if (pagingRef.current) return;
    pagingRef.current = true;
    setLoadingOlder(true);
    try {
      await pageOnce(120);
    } catch {
      // engine may be busy; keep current state
    } finally {
      pagingRef.current = false;
      setLoadingOlder(false);
    }
  };

  /** 大纲跳转（官方 loadThrough 语义）：200/页循环向前翻，直到窗口覆盖到
   *  目标 turn/start 的 seq；无进展（!hasMore 或 firstSeq 不再前移）即止。 */
  const loadThrough = async (seq: number) => {
    if (pagingRef.current) return;
    pagingRef.current = true;
    setLoadingOlder(true);
    try {
      await driveLoadThrough(seq, () => earliestSeqRef.current, pageOnce);
    } catch {
      // engine may be busy; 已翻到的页保留，跳转按当前窗口尽力落点
    } finally {
      pagingRef.current = false;
      setLoadingOlder(false);
    }
  };

  return {
    items, liveRunning, runningSince, plan, goalProj, refreshGoal,
    scheduleRecords, hasMore, loadingOlder, loadOlder, outline, loadThrough,
    loadError, retry: () => setRetryKey((k) => k + 1),
  };
}

/** 深跳翻页驱动（纯函数钉测面）：翻到窗口覆盖 seq 为止；!hasMore、单页无
 *  前移或 60 页上限任一触发即止——防引擎回包异常时死循环。 */
export async function driveLoadThrough(
  seq: number,
  getEarliest: () => number | undefined,
  page: (maxMessages: number) => Promise<{ firstSeq?: number; hasMore: boolean }>,
): Promise<void> {
  let guard = 0;
  while ((getEarliest() ?? 0) > seq && guard++ < 60) {
    const prev = getEarliest();
    const r = await page(200);
    if (!r.hasMore || r.firstSeq === undefined || r.firstSeq >= (prev ?? 0)) break;
  }
}
