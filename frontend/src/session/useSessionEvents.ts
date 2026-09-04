// 会话事件面 hook（R-007 从 SessionView 搬出）：事件日志全量缓存 + 增量摄取、
// 历史/分页加载（含子会话兜底）、mux 实时流、plan/goal 投影轮询、schedule 折叠。
// 不管渲染与滚动 UI（分页锚定经 refs 参数借用组件的滚动容器）。
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { api } from "../api";
import { useStore } from "../store";
import type { HistoryEntry, SessionEvent } from "../types";
import { finalizeTurns, foldSchedule, ingest, makeIngestCtx, type IngestCtx, type RenderItem } from "./renderModel";

export function useSessionEvents(
  sessionId: string,
  refs: { scrollRef: RefObject<HTMLDivElement | null>; olderAnchorRef: RefObject<HTMLElement | null> },
) {
  const store = useStore();
  const [items, setItems] = useState<RenderItem[]>([]);
  // Live turn state from mux events; `summary.running` (store poll) covers
  // reload mid-turn, where no turn/start will ever arrive again.
  const [liveRunning, setLiveRunning] = useState(false);
  const [runningSince, setRunningSince] = useState<number | undefined>(undefined);
  const [plan, setPlan] = useState<{ active: boolean; pending: boolean } | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [earliestSeq, setEarliestSeq] = useState<number | undefined>(undefined);
  // 5.1 Goal：goal 投影整值（mux session/projection 实时推，3s 轮询兜底）
  const [goalProj, setGoalProj] = useState<import("../types").GoalProjection | null | undefined>(undefined);
  const refreshGoal = () => {
    void api.sessions().then((r) => {
      const s = (r.items ?? []).find((x) => x.sessionId === sessionId);
      const v = s?.projections?.values?.goal as import("../types").GoalProjection | null | undefined;
      setGoalProj(v ?? null);
    }).catch(() => void 0);
  };
  // 5.3 Schedule：schedule/change 折叠出的会话提醒目录（只读）
  const [scheduleRecords, setScheduleRecords] = useState<import("../types").ScheduleRecord[]>([]);

  // Turn-level aggregations + stable-id indexes, shared by the history replay
  // and live mux passes so the derivations stay identical.
  const ctx = useRef<IngestCtx>(makeIngestCtx());

  // Full event log (ascending seq) backing this session. Most recent page is
  // loaded from history; older pages are prepended on "载入更早". Every render
  // rebuilds `items` from the whole log so ordering/dedup is deterministic —
  // the official append-only log + derived UI model. Entries keep the engine's
  // view slot (diff cards) alongside the raw event.
  const eventLog = useRef<HistoryEntry[]>([]);

  /** Rebuild rendered items from the full asc event log + ctx. */
  const rebuild = useMemo(() => (entries: HistoryEntry[]) => {
    const rendered: RenderItem[] = [];
    ctx.current = makeIngestCtx();
    for (const entry of entries) {
      ingest(rendered, entry, ctx.current);
    }
    finalizeTurns(rendered, ctx.current);
    return rendered;
  }, []);

  useEffect(() => {
    let alive = true;
    let seqFloor = -1;
    eventLog.current = [];
    ctx.current = makeIngestCtx();
    setItems([]);
    setLiveRunning(false);
    setHasMore(false);
    setEarliestSeq(undefined);

    // Verified engine surface (0.1.2-alpha.2): history pages ride HTTP
    // session.history (dot-form, beforeSeq anchor) and live events ride the
    // broadcast events.mux downlink — session/follow + remote.mux do not
    // exist in this build (PITFALLS 4.6).
    // 子会话（origin==='subagent'）冷读失败时走 subagent.history 面兜底
    //（未激活子会话不在 session store 里，session.history 会 404）。
    const loadPage = async (): Promise<{ events: HistoryEntry[]; hasMore: boolean }> => {
      try {
        return await api.history({ sessionId, maxMessages: 120 });
      } catch (err) {
        const sum = store.sessions.find((x) => x.sessionId === sessionId);
        if (sum?.origin !== "subagent" || !sum.parentSessionId) throw err;
        const list = await api.subagentList({ parentSessionId: sum.parentSessionId });
        const self = list.entries.find((e): e is Extract<import("../types").SubagentListEntry, { kind: "child" }> => e.kind === "child" && e.id === sessionId);
        const mode = self?.mode ?? "continuable";
        const page = await api.subagentHistory({ parentSessionId: sum.parentSessionId, childSessionId: sessionId, mode, maxMessages: 120 });
        return { events: page.events, hasMore: page.hasMore };
      }
    };
    loadPage()
      .then(({ events, hasMore: more }) => {
        if (!alive) return;
        eventLog.current = events;
        setItems(rebuild(eventLog.current));
        setHasMore(more);
        // 历史窗口内的 schedule/change 一并折叠（增量变化由 mux 帧驱动）
        let recs: import("../types").ScheduleRecord[] = [];
        for (const e of events) {
          if (e.event.type === "schedule/change") {
            recs = foldSchedule(recs, e.event.data as import("../types").ScheduleChangeData);
          }
        }
        setScheduleRecords(recs);
        const first = events[0];
        if (first) setEarliestSeq(first.event.seq);
        const last = events[events.length - 1];
        if (last) seqFloor = last.event.seq + 1;
      })
      .catch(() => void 0);

    const off = store.subscribeMux((frame) => {
      if (frame.type === "session/projection") {
        const p = frame as import("../types").ProjectionFrame;
        if (p.sessionId === sessionId && p.key === "goal") {
          setGoalProj((p.value ?? null) as import("../types").GoalProjection | null);
        }
        return;
      }
      if (frame.type !== "session/event") return;
      const ev = (frame as { type: "session/event"; sessionId: string; event: SessionEvent }).event;
      if (ev === undefined || (frame as { sessionId?: string }).sessionId !== sessionId) return;
      if (ev.type === "schedule/change") {
        setScheduleRecords((prev) => foldSchedule(prev, ev.data as import("../types").ScheduleChangeData));
      }
      const seq = ev.seq ?? -1;
      if (seq >= 0 && seq < seqFloor) return;
      setItems((prev) => {
        const log = eventLog.current;
        if (seq >= 0 && log.length && seq <= log[log.length - 1]!.event.seq) return prev;
        log.push({ event: ev });
        // 增量摄取：流式期间每条增量只 ingest 新事件（append-only，seq
        // 递增已由上方守卫），不再对整份 event log 做全量重建 —— 长会话
        // 流式卡顿的主要来源。turn/end 时重插 turn-tail；历史页加载/
        // 载入更早仍走全量 rebuild（前插需要重排序）。
        ingest(prev, { event: ev }, ctx.current);
        if (ev.type === "turn/end") finalizeTurns(prev, ctx.current);
        return prev.slice();
      });
      if (ev.type === "turn/start") {
        setLiveRunning(true);
        setRunningSince(ev.time);
      } else if (ev.type === "turn/end") {
        setLiveRunning(false);
        setRunningSince(undefined);
      }
      if (seq >= 0) seqFloor = seq + 1;
    });

    // plan projection: DSH PlanChip visibility (active, or pending when folded)
    // + goal 投影兜底（正常路径走 session/projection 实时推送）
    const tickPlan = () => {
      api.sessions().then((r) => {
        const s = (r.items ?? []).find((x) => x.sessionId === sessionId);
        const planVal = s?.projections?.values?.plan as { active?: boolean; pending?: boolean } | undefined;
        if (planVal) {
          setPlan({ active: !!planVal.active, pending: !!planVal.pending });
        }
        const goalVal = s?.projections?.values?.goal as import("../types").GoalProjection | null | undefined;
        setGoalProj(goalVal ?? null);
      }).catch(() => void 0);
    };
    tickPlan();
    const planIv = setInterval(tickPlan, 3000);

    return () => {
      alive = false;
      clearInterval(planIv);
      off?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const loadOlder = async () => {
    if (loadingOlder) return;
    const atSeq = earliestSeq;
    if (atSeq === undefined) return;
    setLoadingOlder(true);
    try {
      // Capture the scrollport position of the current first row so we can
      // keep it visually pinned after older rows are prepended.
      const el = refs.olderAnchorRef.current;
      const anchorTop = el ? el.getBoundingClientRect().top - refs.scrollRef.current!.getBoundingClientRect().top : 0;
      const { events: older, hasMore: more } = await api.history({ sessionId, atSeq, maxMessages: 120 });
      eventLog.current = [...older, ...eventLog.current];
      let recs: import("../types").ScheduleRecord[] = [];
      for (const e of eventLog.current) {
        if (e.event.type === "schedule/change") {
          recs = foldSchedule(recs, e.event.data as import("../types").ScheduleChangeData);
        }
      }
      setScheduleRecords(recs);
      setItems(rebuild(eventLog.current));
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
      if (first?.event?.seq !== undefined) setEarliestSeq(first.event.seq);
    } catch {
      // engine may be busy; keep current state
    } finally {
      setLoadingOlder(false);
    }
  };

  return {
    items, liveRunning, runningSince, plan, goalProj, refreshGoal,
    scheduleRecords, hasMore, loadingOlder, loadOlder,
  };
}
