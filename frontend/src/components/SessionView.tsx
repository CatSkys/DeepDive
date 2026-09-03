import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, Pencil, ShieldCheck, Trash2, X } from "lucide-react";
import { ModelMenu, effortDisplayName, type ModelOption } from "./ModelMenu";
import { WorkspacePill } from "./Sidebar";
import { api } from "../api";
import { useStore } from "../store";
import { t, tt, useT } from "../i18n";
import { Composer } from "./Composer";
import { HeroBrand } from "./HeroBrand";
import { Markdown } from "./Markdown";
import LoadingState from "./LoadingState";
import ThinkingState from "./ThinkingState";
import {
  IconApiOutline14,
  IconBrowseOutline16,
  IconBranchOutline16,
  IconCheckOutline16,
  IconChecklistOutline14,
  IconCodeOutline16,
  IconCopyOutline16,
  IconEditOutline16,
  IconQuestionOutline14,
  IconSearchOutline16,
  IconSkillOutline16,
  IconSparkle16,
} from "./Icons";
import type {
  AssistantMessageData,
  ContentBlock,
  HistoryEntry,
  HistoryEntryView,
  ReasoningBlock,
  StreamChunk,
  TextBlock,
  ToolCallData,
  ToolResultData,
  SessionEvent,
  SessionQueuedItem,
  UserMessageData,
} from "../types";
import { narrowDiffs } from "../diffModel";
import { planReviewOf } from "../planReview";
import { DiffBlock } from "./DiffBlock";
import { PlanReviewCard } from "./PlanReviewCard";
import { TurnUsagePop } from "./UsageMeter";
import { GoalBar } from "./GoalBar";
import { SubagentLineage, SubagentReadOnlyNotice } from "./SubagentLineage";
import { JobsMenu, ScheduleMenu } from "./JobsMenu";
import { UserAttachments } from "./AttachmentImage";
import { groupTurns, foldDecision, type TurnGroup } from "../turnGroups";

export interface WorkflowMember {
  seq: number;
  label: string;
  phase?: string;
  childId?: string;
  outcome?: "completed" | "failed" | "cancelled";
}

export interface RenderItem {
  key: string;
  kind: "user" | "assistant" | "tool-call" | "chunk" | "reasoning" | "turn-tail" | "command" | "injection" | "compaction" | "retry" | "workflow";
  event?: SessionEvent;
  toolName?: string;
  toolCallId?: string;
  args?: string;
  output?: string;
  failed?: boolean;
  time?: number;
  turn?: number;
  /** 命令卡：run/done 以 commandId 配对，done 到达时就地补状态与结果文本。 */
  commandId?: string;
  commandStatus?: "running" | "success" | "error";
  commandText?: string;
  /** 工作流卡：成员按 seq 归并（agent-start/end 配对）。 */
  members?: WorkflowMember[];
  /** 注入行：user/message 的 source.kind（plugin/skill-catalog…）。 */
  injectionLabel?: string;
  /** 压缩卡：compactionId 去重键。 */
  compactionId?: string;
  /** 重试行：retryId 去重键（同一等待更新不新增）。 */
  retryId?: string;
  // 编辑类工具的文件变更（call 侧=pending 态；result 侧=已应用，权威）
  diffs?: import("../types").FileDiff[];
  // attached turn-level stats for the closing assistant message meta row
  meta?: TurnMeta;
  // turn-local produced file paths (attached during finalizeTurns)
  produced?: string[];
  // turn/end 的 seq：branch（session.fork atSeq）的收尾锚点
  forkSeq?: number;
  // 轮终原因（3.5 轮失败增强：error 消息/max-tokens 继续按钮）
  endReason?: import("../types").TurnEndReason;
  // 本轮累计 token 用量（assistant usage，轮尾弹层）
  usage?: import("../types").TokenUsage;
}

interface TurnMeta {
  runMs: number;
  ttftMs: number | null;
  tokensPerSecond: number | null;
}

/** Access chip（官方 permission 预设呈现）：只读展示当前预设。
 *  切换依赖 `/permission` 斜杠命令，而 rc.2 浏览器面不做命令派发
 *  （DSH-WIRE §4）——升引擎后接回切换菜单。数据缺省时不渲染。 */
function AccessChip({ sessionId }: { sessionId: string }) {
  const { sessions } = useStore();
  const { t } = useT();
  const summary = sessions.find((s) => s.sessionId === sessionId);
  const perm = summary?.projections?.values?.permissions as
    | { options?: Array<{ value: string; name?: string }>; currentValue?: string }
    | undefined;
  if (!perm?.currentValue || !perm.options?.length) return null;
  return (
    <span
      className="access-chip"
      title={t("当前权限预设（当前引擎版本不支持会话内切换）")}
    >
      <ShieldCheck size={12} />
      {perm.currentValue}
    </span>
  );
}

export function SessionView({ sessionId }: { sessionId: string }) {
  useT(); // 订阅语言切换：本组件文案走全局 t()/tt()，语言变更时需重渲染
  const store = useStore();
  const { approvals, questions, queues, sessions, subscribeMux } = store;
  const [items, setItems] = useState<RenderItem[]>([]);
  // Live turn state from mux events; `summary.running` (store poll) covers
  // reload mid-turn, where no turn/start will ever arrive again.
  const [liveRunning, setLiveRunning] = useState(false);
  const [runningSince, setRunningSince] = useState<number | undefined>(undefined);
  const [plan, setPlan] = useState<{ active: boolean; pending: boolean } | undefined>(undefined);
  const [modelName, setModelName] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [showModels, setShowModels] = useState(false);
  // 思考强度（推理档位）：随所选模型的能力元数据出现，无 reasoning 元数据的
  // 模型不显示档位。effort === undefined 表示跟随提供商默认档。
  const [currentModel, setCurrentModel] = useState<{ provider: string; model: string } | undefined>(undefined);
  const [effortLevels, setEffortLevels] = useState<Array<{ id: string; name: string }>>([]);
  const [effort, setEffort] = useState<string | undefined>(undefined);
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
  // 轮折叠开关（长会话默认折叠早前轮；点击折叠条或关闭开关展开）
  const [turnsFolded, setTurnsFolded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const olderAnchorRef = useRef<HTMLElement | null>(null);
  const summary = sessions.find((s) => s.sessionId === sessionId);
  const title = summary
    ? (summary.projections?.values?.title as string) || (summary.blank ? t("新会话") : t("会话"))
    : t("会话");

  // Turn-level aggregations + stable-id indexes, shared by the history replay
  // and live mux passes so the derivations stay identical.
  const ctx = useRef<IngestCtx>(makeIngestCtx());

  useEffect(() => {
    // alpha.2: session/models and llm/models are gone from the browser face —
    // the unified catalog loader (session/modelCatalog with rc.2 fallback)
    // provides both the options and the engine default selection.
    void (async () => {
      let options: ModelOption[] = [];
      try {
        const r = await api.modelOptions();
        options = r.options;
        setModels(options);
        // llm/models 兜底路径没有 default 字段——不能在这里提前 return，
        // 否则下面的 session.models（实时选择 + 思考强度元数据）永远不跑。
        if (r.default) {
          const hit = options.find((m) => m.provider === r.default!.provider && m.model === r.default!.model);
          setModelName(hit?.label ?? `${r.default!.provider} / ${r.default!.model}`);
        }
      } catch { /* engine booting */ }
      // The live per-session selection (when it differs from the default).
      // session.models 一次带回当前选择（含 reasoningEffort）与分组目录
      // （含各模型的 reasoning 档位元数据），无需第二次调用。
      try {
        const r = await api.sessionModels({ sessionId });
        const cur = r.current;
        if (cur?.model) {
          const hit = options.find((m) => m.provider === cur.provider && m.model === cur.model);
          setModelName(hit?.label ?? cur.model);
        }
        if (cur?.provider && cur?.model) setCurrentModel({ provider: cur.provider, model: cur.model });
        setEffort(cur?.reasoningEffort ?? undefined);
        const group = (r.groups ?? []).find((g) => g.id === cur?.provider);
        const model = group?.models?.find((m) => m.id === cur?.model);
        setEffortLevels(model?.reasoning?.efforts ?? []);
        // 分组目录里每个模型自带 reasoning 档位元数据 —— 并进选项，
        // 模型菜单据此决定"点了直接选"还是"进档位滑杆页"。
        const effortByModel = new Map<string, { efforts: Array<{ id: string; name: string }>; defaultEffort?: string }>();
        for (const g of r.groups ?? []) {
          for (const m of g.models ?? []) {
            if (m.reasoning?.efforts?.length) {
              effortByModel.set(`${g.id}/${m.id}`, { efforts: m.reasoning.efforts, defaultEffort: m.reasoning.defaultEffort });
            }
          }
        }
        setModels(options.map((o) => {
          const meta = effortByModel.get(`${o.provider}/${o.model}`);
          return meta ? { ...o, efforts: meta.efforts, defaultEffort: meta.defaultEffort } : o;
        }));
      } catch { /* optional enrichment */ }
    })();
  }, [sessionId]);

  const pickModel = async (m: ModelOption) => {
    // 菜单关闭由 ModelMenu 决定：无档位模型选完即关；带档位的进滑杆页，
    // 档位滑杆松手即通过 applyModelEffort 一次提交模型+档位后关闭。
    setModelName(m.label);
    try {
      await api.selectModel({ sessionId, provider: m.provider, model: m.model });
    } catch { /* engine may be busy */ }
  };

  const effortLabel = (id: string | undefined) => effortDisplayName(id, effortLevels);

  const applyModelEffort = async (m: ModelOption, id: string | undefined) => {
    setModelName(m.label);
    setCurrentModel({ provider: m.provider, model: m.model });
    setEffort(id);
    try {
      await api.selectModel({
        sessionId,
        provider: m.provider,
        model: m.model,
        ...(id === undefined ? {} : { reasoningEffort: id }),
      });
    } catch { /* engine may be busy */ }
  };

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

    const off = subscribeMux((frame) => {
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

  useEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items, follow]);

  const loadOlder = async () => {
    if (loadingOlder) return;
    const atSeq = earliestSeq;
    if (atSeq === undefined) return;
    setLoadingOlder(true);
    try {
      // Capture the scrollport position of the current first row so we can
      // keep it visually pinned after older rows are prepended.
      const el = olderAnchorRef.current;
      const anchorTop = el ? el.getBoundingClientRect().top - scrollRef.current!.getBoundingClientRect().top : 0;
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
        const sc = scrollRef.current;
        const a = olderAnchorRef.current;
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

  const pending = [...approvals.values()].filter((a) => a.sessionId === sessionId);
  const sessionQuestions = [...questions.values()].filter((q) => q.sessionId === sessionId);
  // 排队消息（placement=queued 才可操作；steering/context 正在处理）
  const queuedItems = (queues.get(sessionId) ?? []).filter((i) => i.placement === "queued");

  // branch（官方 forkAt）：从轮收尾 seq 分叉子会话并切入；失败保持原会话不动。
  const branchFrom = (atSeq: number) => {
    api.fork({ sessionId, atSeq })
      .then((r) => {
        void store.refresh();
        store.openSession(r.sessionId);
      })
      .catch(() => void 0);
  };

  const isBlank = summary ? !!summary.blank : items.length === 0;
  const running = liveRunning || !!summary?.running;
  // 用量/占用投影（3.1）：空值时 Composer 内的容量圈不渲染
  const projVals = (summary?.projections?.values ?? {}) as {
    tokenUsage?: { uncachedInputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
    contextPressure?: { projectedTokens?: number; contextWindow?: number };
    contextBreakdown?: { systemTokens?: number; toolsTokens?: number; messageTokens?: number };
  };
  // 容量圈数据挂在输入框上（发送/听写钮左侧，hover 出面板）
  const ctxData = {
    projected: projVals.contextPressure?.projectedTokens,
    window: projVals.contextPressure?.contextWindow,
    usage: projVals.tokenUsage,
    breakdown: projVals.contextBreakdown,
  };

  if (isBlank) {
    return (
      <>
        <div className="session-header">
          <div className="left">
            <div className="title-row">
              <div className="title">{title}</div>
              <WorkspacePill />
            </div>
            <button className="model trigger" data-open={showModels ? "true" : "false"} title={t("模型与推理")} onClick={() => setShowModels(true)}>
              {modelName || "Auto"}
              {effortLevels.length > 0 && <span className="effort-tag">{effortLabel(effort)}</span>}
              <ChevronDown size={12} className="trigger-chev" />
            </button>
            {showModels && (
              <ModelMenu
                options={models}
                current={modelName}
                currentModel={currentModel}
                effortValue={effort}
                onPick={(m) => void pickModel(m)}
                onApplyEffort={(m, id) => void applyModelEffort(m, id)}
                onClose={() => setShowModels(false)}
              />
            )}
          </div>
        </div>
        <div className="hero">
          <HeroBrand />
          <div className="hero-composer">
            <GoalBar projection={goalProj} onChange={refreshGoal} sessionId={sessionId} />
            <Composer sessionId={sessionId} ctx={ctxData} />
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="session">
      <div className="session-header">
        <div className="left">
          <div className="title-row">
            <div className="title">{title}</div>
            <WorkspacePill />
          </div>
          <button className="model trigger" data-open={showModels ? "true" : "false"} title={t("模型与推理")} onClick={() => setShowModels(true)}>
            {modelName || "Auto"}
            {effortLevels.length > 0 && <span className="effort-tag">{effortLabel(effort)}</span>}
            <ChevronDown size={12} className="trigger-chev" />
          </button>
          {showModels && (
            <ModelMenu
              options={models}
              current={modelName}
              currentModel={currentModel}
              effortValue={effort}
              onPick={(m) => void pickModel(m)}
              onApplyEffort={(m, id) => void applyModelEffort(m, id)}
              onClose={() => setShowModels(false)}
            />
          )}
        </div>
        {plan?.active && !plan?.pending && (
          <span className="plan-wrap">
            <button
              type="button"
              className="plan-chip"
              title={t("退出计划模式")}
              aria-label={t("退出计划模式")}
              onClick={() => {
                api.prompt({
                  sessionId,
                  mode: "queue",
                  content: [{ type: "text", text: "/plan off" }],
                }).catch(() => void 0);
              }}
            >
              Plan ×
            </button>
          </span>
        )}
        <AccessChip sessionId={sessionId} />
        <SubagentLineage sessionId={sessionId} />
        <JobsMenu sessionId={sessionId} />
        <ScheduleMenu records={scheduleRecords} />
      </div>
      <div className="flow" ref={scrollRef} onScroll={(e) => {
        const el = e.currentTarget;
        setFollow(el.scrollTop + el.clientHeight >= el.scrollHeight - 32);
      }}>
        <div className="flow-inner">
          {hasMore && (
            <button
              type="button"
              className="load-older"
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
            >
              {loadingOlder ? t("加载中…") : t("载入更早")}
            </button>
          )}
          {(() => {
            // DSH data-actions-reveal gate: the latest user row and the latest
            // turn tail hold 'always' (kept visible); earlier rows reveal on
            // hover / focus-within.
            // 轮折叠：长会话默认折叠早前轮（除最近 2 轮），折叠条点击展开。
            let lastUserIdx = -1;
            let lastTailIdx = -1;
            for (let i = 0; i < items.length; i++) {
              if (items[i].kind === "user") lastUserIdx = i;
              if (items[i].kind === "turn-tail") lastTailIdx = i;
            }
            const keyIdx = new Map(items.map((it, i) => [it.key, i] as const));
            const groups = groupTurns(items);
            const fold = foldDecision(groups.length);
            // turnsFolded=false 时 foldFrom=0（全部渲染）；=groups.length 会把整流折空
            const foldFrom = fold && turnsFolded ? fold.foldFrom : 0;
            const nodes: React.ReactNode[] = [];
            let foldedCount = 0;
            let foldBarEmitted = false;
            groups.forEach((g: TurnGroup, gi: number) => {
              if (gi < foldFrom) {
                foldedCount += g.items.length;
                return;
              }
              if (foldedCount > 0) {
                nodes.push(
                  <button
                    key="turn-fold-bar"
                    type="button"
                    className="turn-fold"
                    ref={(el: HTMLButtonElement | null) => { olderAnchorRef.current = el; }}
                    onClick={() => setTurnsFolded(false)}
                  >
                    {tt("已折叠早前 {n} 轮 · 点击展开", "Folded {n} earlier turns · click to expand", { n: foldedCount })}
                  </button>,
                );
                foldedCount = 0;
                foldBarEmitted = true;
              }
              for (const item of g.items) {
                const idx = keyIdx.get(item.key) ?? -1;
                nodes.push(
                  <div
                    key={item.key}
                    className="chat-anchor-row"
                    ref={idx === 0 && !foldBarEmitted ? ((el: HTMLDivElement | null) => { olderAnchorRef.current = el; }) : undefined}
                  >
                    <Item
                      item={item}
                      latestUser={idx === lastUserIdx}
                      latestTurn={idx === lastTailIdx}
                      turnRunning={running}
                      onBranch={branchFrom}
                      sessionId={sessionId}
                      onContinue={() => {
                        void api.prompt({ sessionId, mode: "queue", content: [{ type: "text", text: t("继续") }] }).catch(() => void 0);
                      }}
                    />
                  </div>,
                );
              }
            });
            return nodes;
          })()}
          {pending.map((a) => (
            <ApprovalCard key={a.approvalId} approvalId={a.approvalId} rpcId={a.rpcId} sessionId={sessionId} toolName={a.toolName} reason={a.reason} />
          ))}
          {sessionQuestions.map((q) => {
            // plan-review 提意 → 决策卡接管；其余保持通用提问流（官方分流规则）
            const review = planReviewOf(q.questions);
            if (review) {
              return <PlanReviewCard key={q.rpcId} rpcId={q.rpcId} sessionId={sessionId} review={review} />;
            }
            return <QuestionCard key={q.rpcId} rpcId={q.rpcId} sessionId={sessionId} questions={q.questions} />;
          })}
          {running && <LoadingState label="Deep diving..." since={runningSince} />}
        </div>
      </div>
      {!follow && (
        <button
          className="jump-down"
          title={t("回到最新")}
          onClick={() => {
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
            setFollow(true);
          }}
        >
          <ArrowDown size={16} />
        </button>
      )}
      {queuedItems.length > 0 && (
        <div className="queue-dock-wrap">
          <QueueDock sessionId={sessionId} items={queuedItems} />
        </div>
      )}
      <div className="session-bottom">
        <GoalBar projection={goalProj} onChange={refreshGoal} sessionId={sessionId} />
        {summary?.origin === "subagent" ? (
          <SubagentReadOnlyNotice parentSessionId={summary.parentSessionId} />
        ) : (
          <Composer sessionId={sessionId} ctx={ctxData} />
        )}
      </div>
    </div>
  );
}

function Item({ item, latestUser, latestTurn, turnRunning, onBranch, onContinue, sessionId }: {
  item: RenderItem;
  latestUser: boolean;
  latestTurn: boolean;
  turnRunning: boolean;
  onBranch?: (forkSeq: number) => void;
  onContinue?: () => void;
  sessionId: string;
}) {
  if (item.kind === "user") {
    return (
      <div className="msg-block user" data-actions-reveal={latestUser ? "always" : "hover"}>
        <UserBubble text={textOf(item.event)} />
        <UserAttachments sessionId={sessionId} event={item.event} />
        {/* DSH user chrome: copy + clock only, NO branch, clock="start" */}
        <MessageMeta
          time={item.time}
          clockSide="start"
          copiedText={textOf(item.event)}
        />
      </div>
    );
  }
  if (item.kind === "assistant") {
    const t = textOf(item.event);
    if (!t) return null;
    const blocks = blocksOf(item.event);
    return (
      <div className="msg-block assistant">
        {blocks.think && <ThinkingState reasoning={blocks.think} running={false} />}
        <AgentMessage text={t} />
      </div>
    );
  }
  if (item.kind === "reasoning") {
    // Live reasoning-delta accumulation; exists only mid-turn until the final
    // assistant message replaces it with the settled trace.
    const text = item.output ?? "";
    if (!text) return null;
    return <ThinkingState reasoning={text} running={turnRunning} />;
  }
  if (item.kind === "turn-tail") {
    // DSH turn-tail chrome: produced files + copy / branch / clock("end") +
    // usage stats, in its own node so tool-only / interrupted turns keep them.
    const time = item.time;
    const meta = item.meta;
    const copiedText = item.event ? textOf(item.event) : "";
    const reason = item.endReason;
    const reasonKind = typeof reason === "object" && reason !== null ? (reason as { kind?: string }).kind : undefined;
    const errMsg = reasonKind === "error" ? (reason as { error?: { message?: string; code?: string } }).error?.message : undefined;
    const errCode = reasonKind === "error" ? (reason as { error?: { code?: string } }).error?.code : undefined;
    return (
      <div className="turn-tail" data-actions-reveal={latestTurn ? "always" : "hover"}>
        {reasonKind === "max-tokens" && (
          <div className="turn-issue">
            <span>{t("本轮达到 max tokens 上限，输出被截断")}</span>
            <button className="turn-issue-btn" onClick={onContinue}>{t("继续")}</button>
          </div>
        )}
        {reasonKind === "error" && (
          <div className="turn-issue" data-code={errCode ?? ""}>
            <span>
              {t("本轮失败")}
              {errMsg ? `：${errMsg}` : ""}
              {errCode === "MISSING_CREDENTIAL" ? `（${t("请在设置中配置 API Key 后重试")}）` : ""}
            </span>
          </div>
        )}
        <ProducedFiles paths={item.produced ?? []} />
        <MessageMeta
          time={time}
          clockSide="end"
          runMs={meta?.runMs}
          ttftMs={meta?.ttftMs ?? undefined}
          tokensPerSecond={meta?.tokensPerSecond ?? undefined}
          copiedText={copiedText}
          branch
          usage={item.usage}
          onBranch={item.forkSeq !== undefined ? () => onBranch?.(item.forkSeq!) : undefined}
        />
      </div>
    );
  }
  if (item.kind === "injection") {
    // 上下文注入折叠行：默认只露来源标签，展开看注入全文
    const text = item.event ? textOfInjection(item.event) : "";
    return <InjectionRow label={item.injectionLabel ?? "context"} text={text} />;
  }
  if (item.kind === "compaction") {
    return <CompactionCard summary={item.output ?? ""} shadowedTokens={item.args} />;
  }
  if (item.kind === "retry") {
    return <div className="retry-row"><StateDot state="warning" />{t("模型请求重试")}<span className="retry-detail">{item.output}</span></div>;
  }
  if (item.kind === "tool-call") {
    return (
      <ToolRow
        toolName={item.toolName ?? "tool"}
        args={item.args ?? ""}
        output={item.output}
        failed={item.failed}
        diffs={item.diffs}
      />
    );
  }
  if (item.kind === "command") {
    return <CommandCard name={item.toolName ?? "cmd"} args={item.args ?? ""} status={item.commandStatus ?? "running"} text={item.commandText} />;
  }
  if (item.kind === "workflow") {
    return <WorkflowCard name={item.args ?? t("工作流")} members={item.members ?? []} status={item.commandStatus} stopReason={item.commandText} />;
  }
  if (item.kind === "chunk" && item.output) {
    return <div className="msg assistant"><div className="text">{item.output}</div></div>;
  }
  return null;
}

/// User message: down-scaled bubble (deliberately quiet, weak layer).
function UserBubble({ text }: { text: string }) {
  return (
    <div className="user-bubble">{text}</div>
  );
}

/// Agent reply: pure text — NO bubble, NO element background (design rule).
function AgentMessage({ text }: { text: string }) {
  return (
    <div className="agent-message">
      <Markdown text={text} />
    </div>
  );
}

/** 常见工具名的中文标题；未收录的显示原名。 */
const TOOL_TITLE_ZH: Record<string, string> = {
  ask_user_question: "提问",
  todo_write: "任务",
  todos: "任务",
  str_replace_editor: "编辑",
  multiedit: "批量编辑",
  apply_patch: "应用补丁",
  glob: "查找文件",
  grep: "搜索内容",
  web_search: "联网搜索",
  web_fetch: "抓取网页",
  list_files: "列出文件",
};

/// One-line tool row — DSH ToolRow port: icon + name · summary + chevron,
/// expandable to reveal terminal output or raw arguments.
function ToolRow({ toolName, args, output, failed, diffs }: {
  toolName: string;
  args: string;
  output?: string;
  failed?: boolean;
  diffs?: import("../types").FileDiff[];
}) {
  const [open, setOpen] = useState(false);
  const todo = parseTodos(args);
  const isTodo = toolName === "todo_write" || toolName === "todos" || todo !== null;
  const isAsk = toolName === "ask_user_question" || toolName === "ask_user";
  const summary = isAsk ? askSummary(args) : todo !== null ? tt("{done}/{total} 已完成 · {active} 进行中 · {pending} 待处理", "{done}/{total} done · {active} in progress · {pending} pending", { done: todo.done, total: todo.total, active: todo.active, pending: todo.pending }) : summarizeArgs(args);
  const filePath = derivePath(toolName, args);
  const isBash = toolName === "bash" || toolName === "terminal-bash";
  const state = failed ? "error" : output !== undefined ? "done" : "running";
  const title = isTodo ? t("任务") : isAsk && state === "running" ? t("等待回答") : state === "running" ? t("正在执行") : t(TOOL_TITLE_ZH[toolName] ?? toolName);
  const expandable = (output !== undefined && output !== "") || args !== "" || isTodo || (!!diffs && diffs.length > 0);
  return (
    <div className={`tool-row${state === "error" ? " bad" : ""}`} data-state={state} data-tool={toolName}>
      <button
        className="tool-row-main"
        onClick={() => (expandable ? setOpen((v) => !v) : undefined)}
        aria-expanded={open}
      >
        <span className="tool-leading">
          {state === "error" ? <StateDot state="error" /> : state === "running" ? <StateDot state="running" /> : isTodo ? <IconChecklistOutline14 /> : <ToolIcon name={toolName} />}
        </span>
        <span className="tool-title">{title}</span>
        {summary && (
          <>
            <span className="tool-sep" aria-hidden="true" />
            {filePath && <FileLangIcon file={filePath} />}
            <span className="tool-summary">{summary}</span>
          </>
        )}
        {expandable && (
          <span className="tool-chevron" data-open={open ? "true" : "false"}>
            <ChevronDown size={14} />
          </span>
        )}
      </button>
      {expandable && (
        <div className="tool-collapse" data-open={open ? "true" : "false"}>
          <div className="tool-body">
            {isTodo && todo !== null ? (
              <TodoList todos={todo.items} />
            ) : isBash ? (
              <TerminalBlock command={commandOf(args)} output={output ?? ""} failed={failed} />
            ) : (
              <>
                {diffs && diffs.length > 0 && <DiffBlock diffs={diffs} />}
                {args && <div className="tool-io-label">{t("输入")}</div>}
                {args && <pre className="tool-io-text">{prettyArgs(args)}</pre>}
                {output !== undefined && output !== "" && (
                  <>
                    <div className="tool-io-label">{t("输出")}</div>
                    <pre className="tool-io-text">{output}</pre>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 命令卡：`/name args` 单行 + 状态点 + 结果文本（success 提示/error 展开）。
 *  对照官方 ui-conversation command 节点：命令是 log-only 的静默行，不抢消息流的戏。 */
function CommandCard({ name, args, status, text }: {
  name: string;
  args: string;
  status: "running" | "success" | "error";
  text?: string;
}) {
  const [open, setOpen] = useState(false);
  const hasBody = !!text;
  return (
    <div className="command-card" data-status={status}>
      <button
        type="button"
        className="command-main"
        onClick={() => (hasBody ? setOpen((v) => !v) : undefined)}
        aria-expanded={open}
      >
        <span className="command-leading">
          {status === "running" ? <StateDot state="running" /> : status === "error" ? <StateDot state="error" /> : <IconCheckOutline16 size={13} />}
        </span>
        <span className="command-name">/{name}</span>
        {args && <span className="command-args">{args}</span>}
        {status === "success" && !text && <span className="command-hint">{t("已完成")}</span>}
      </button>
      {hasBody && open && <div className="command-body">{text}</div>}
    </div>
  );
}

/** 工作流运行卡（5.4）：tool-workflow/* 事件驱动的嵌套成员卡。
 *  成员行=状态点+标签（+阶段），点击切入成员子会话；run-end 后定格终止原因。 */
function WorkflowCard({ name, members, status, stopReason }: {
  name: string;
  members: WorkflowMember[];
  status?: "running" | "success" | "error";
  stopReason?: string;
}) {
  const { openSession } = useStore();
  const [open, setOpen] = useState(true);
  const done = members.filter((m) => m.outcome).length;
  const failed = members.filter((m) => m.outcome === "failed").length;
  return (
    <div className="workflow-card" data-status={status ?? "running"}>
      <button type="button" className="workflow-main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="workflow-leading">
          {status === "success" ? <IconCheckOutline16 size={13} /> : status === "error" ? <StateDot state="error" /> : <StateDot state="running" />}
        </span>
        <span className="workflow-name">{name}</span>
        <span className="workflow-count">
          {tt("{done}/{total} 成员", "{done}/{total} members", { done, total: members.length })}
          {failed > 0 ? ` · ${tt("{n} 失败", "{n} failed", { n: failed })}` : ""}
        </span>
        {status === "error" && stopReason && <span className="workflow-reason">{stopReason}</span>}
        <ChevronDown size={13} className="injection-chev" data-open={open ? "true" : "false"} />
      </button>
      {open && (
        <div className="workflow-members">
          {members.map((m) => (
            <button
              key={m.seq}
              type="button"
              className="workflow-member"
              onClick={() => (m.childId ? openSession(m.childId) : undefined)}
              disabled={!m.childId}
            >
              <span className={`state-dot ${m.outcome === "failed" || m.outcome === "cancelled" ? "error" : m.outcome === "completed" ? "ok" : "running"}`} aria-hidden="true" />
              <span className="workflow-member-label">{m.label}</span>
              {m.phase && <span className="workflow-phase">{m.phase}</span>}
              <span className="workflow-outcome">{m.outcome ? tt(...(MEMBER_OUTCOME[m.outcome] ?? ["", ""])) : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** schedule/change 折叠（5.3，官方 schedule 域 fold）：create→登记、
 *  delete→移除、dispatch/advance→定格。纯函数，vitest 钉住。 */
export function foldSchedule(records: import("../types").ScheduleRecord[], data: import("../types").ScheduleChangeData): import("../types").ScheduleRecord[] {
  if (data.operation === "create") {
    if (records.some((r) => r.id === data.schedule.id)) return records;
    return [...records, data.schedule];
  }
  if (data.operation === "delete") return records.filter((r) => r.id !== data.id);
  return records; // dispatch/advance 只影响投递史，目录不展示已派发项
}

/** 工作流成员结果文案。 */
const MEMBER_OUTCOME: Record<string, [string, string]> = {
  completed: ["完成", "done"],
  failed: ["失败", "failed"],
  cancelled: ["已取消", "cancelled"],
};

/// Task list panel inside the todo row — DSH todo body list.
function TodoList({ todos }: { todos: Array<{ content: string; status: string }> }) {  return (
    <div className="todo-list">
      {todos.map((t, i) => (
        <div key={i} className={`todo-item ${t.status}`}>
          <span className="todo-bullet" aria-hidden="true">
            {t.status === "completed" ? <IconCheckOutline16 size={12} /> : <span className="todo-dot" />}
          </span>
          <span className="todo-content">{t.content}</span>
          <span className="todo-status">{t.status === "completed" ? tt("已完成", "Done") : t.status === "in_progress" ? tt("进行中", "In progress") : tt("待处理", "Pending")}</span>
        </div>
      ))}
    </div>
  );
}

/// ask_user_question 行摘要：首题问题文本（多题标注数量），避免裸 JSON。
function askSummary(args: string): string {
  try {
    const p = JSON.parse(args);
    const questions = p?.questions ?? (Array.isArray(p) ? p : null);
    if (!Array.isArray(questions) || questions.length === 0) return "";
    const first = String(questions[0]?.question ?? "").split("\n")[0].trim();
    return questions.length > 1 ? tt("{first} 等 {n} 题", "{first} +{n} more", { first, n: questions.length }) : first;
  } catch { return ""; }
}

export function parseTodos(args: string): { done: number; total: number; active: number; pending: number; items: Array<{ content: string; status: string }> } | null {
  if (!args) return null;
  try {
    const p = JSON.parse(args);
    const todos = p?.todos ?? (Array.isArray(p) ? p : null);
    if (!Array.isArray(todos) || todos.length === 0) return null;
    const items = todos.map((t: unknown) => {
      const o = (t ?? {}) as Record<string, unknown>;
      const content = typeof o.content === "string" ? o.content : typeof o.todo === "string" ? o.todo : typeof o.description === "string" ? o.description : JSON.stringify(t);
      return { content, status: typeof o.status === "string" ? o.status : "pending" };
    });
    const done = items.filter((x) => x.status === "completed").length;
    const active = items.filter((x) => x.status === "in_progress").length;
    return { done, total: items.length, active, pending: items.length - done - active, items };
  } catch {
    return null;
  }
}

/// Terminal port of DSH TerminalBlock (bash execution state).
function TerminalBlock({ command, output, failed }: { command: string; output: string; failed?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const MAX_LINES = 16;
  const lines = useMemo(() => output.split("\n"), [output]);
  const hidden = lines.length - MAX_LINES;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch { /* clipboard may be unavailable */ }
  };
  return (
    <div className="terminal-block" data-terminal="">
      <div className="terminal-header">
        <code className="terminal-command">$ {command}</code>
        <span className={`terminal-status${failed ? " error" : ""}`}>
          {failed ? t("退出码 非 0") : output && lines.length > MAX_LINES ? tt("{n} 行", "{n} lines", { n: hidden }) : ""}
        </span>
        <button type="button" className="terminal-copy" onClick={() => void copy()}>
          {copied ? <IconCheckOutline16 size={13} /> : <IconCopyOutline16 size={13} />}
          {copied ? t("复制成功") : t("复制")}
        </button>
      </div>
      {output !== "" && (
        <pre className="terminal-output">
          {(hidden > 0 && !expanded ? lines.slice(0, MAX_LINES) : lines).map((l, i) => (
            <span key={i} className="terminal-line">{l}{"\n"}</span>
          ))}
        </pre>
      )}
      {hidden > 0 && (
        <button className="terminal-expand" onClick={() => setExpanded((v) => !v)}>
          {expanded ? t("收起") : tt("… 其余 {n} 行", "… {n} more lines", { n: hidden })}
        </button>
      )}
    </div>
  );
}

/// Produced files lane — DSH ProducedFiles port (label + file chips).
function ProducedFiles({ paths }: { paths: string[] }) {
  if (paths.length === 0) return null;
  const shown = paths.slice(0, 6);
  const hidden = paths.length - shown.length;
  return (
    <div className="produced">
      <span className="produced-label">{t("产物")}</span>
      <div className="produced-row">
        {shown.map((p) => (
          <button type="button" key={p} className="produced-file" title={p}>
            {basename(p)}
          </button>
        ))}
        {hidden > 0 && <span className="produced-more">{tt("+ {n} 个文件", "+{n} files", { n: hidden })}</span>}
      </div>
    </div>
  );
}

/// Message foot row — copy [+ branch] + clock · [用时 · 首 token · tok/s].
/// Mirrors DSH MessageIconActions: user chrome = copy + clock("start");
/// assistant turn tail = copy + branch + clock("end") + usage stats.
/// Quiet by default: reveals on hover (DSH actions affordance).
function MessageMeta({ time, runMs, ttftMs, tokensPerSecond, copiedText, clockSide = "end", branch = false, onBranch, usage }: {
  time?: number;
  runMs?: number;
  ttftMs?: number;
  tokensPerSecond?: number;
  copiedText: string;
  clockSide?: "start" | "end";
  branch?: boolean;
  onBranch?: () => void;
  usage?: import("../types").TokenUsage;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copiedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch { /* ignore */ }
  };
  const hasStats = runMs !== undefined || ttftMs !== undefined || tokensPerSecond !== undefined;
  const clock = time ? formatClock(time) : undefined;
  if (!clock && !hasStats && !branch) return null;
  const clockEl = (
    <TurnUsagePop usage={usage}>
      <span className="meta-clock">
        {clock}
        {runMs !== undefined && (
          <>
            <span className="meta-dot" aria-hidden="true">·</span>
            {t("用时")} {formatRunDuration(runMs)}
          </>
        )}
        {ttftMs !== undefined && (
          <>
            <span className="meta-dot" aria-hidden="true">·</span>
            {t("首 token")} {formatLatencySeconds(ttftMs)}
          </>
        )}
        {tokensPerSecond !== undefined && (
          <>
            <span className="meta-dot" aria-hidden="true">·</span>
            {formatTokensPerSecond(tokensPerSecond)} tok/s
          </>
        )}
      </span>
    </TurnUsagePop>
  );
  return (
    <div className="meta-actions">
      {clockSide === "start" ? clockEl : null}
      <button className="meta-action" title={copied ? t("复制成功") : t("复制")} aria-label={copied ? t("复制成功") : t("复制")} onClick={() => void copy()}>
        {copied ? <IconCheckOutline16 size={16} /> : <IconCopyOutline16 size={16} />}
      </button>
      {branch && (
        <button
          className="meta-action"
          title={t("分支")}
          aria-label={t("分支")}
          onClick={onBranch}
        >
          <IconBranchOutline16 size={16} />
        </button>
      )}
      {clockSide === "end" ? clockEl : null}
    </div>
  );
}

/** 上下文注入折叠行（3.3）：默认一行来源标签，点击展开注入全文。 */
function InjectionRow({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="injection-row" data-open={open ? "true" : "false"}>
      <button type="button" className="injection-main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ChevronDown size={12} className="injection-chev" />
        <span>{t("上下文注入")}</span>
        <span className="injection-label">{label}</span>
      </button>
      {open && <pre className="injection-body">{text}</pre>}
    </div>
  );
}

/** 压缩标记卡（3.4）：compaction/summary 的流内标记，展开看压缩摘要。 */
function CompactionCard({ summary, shadowedTokens }: { summary: string; shadowedTokens?: string }) {
  const [open, setOpen] = useState(false);
  const n = shadowedTokens ? Number(shadowedTokens) : NaN;
  return (
    <div className="compaction-card" data-open={open ? "true" : "false"}>
      <button type="button" className="compaction-main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="compaction-ic" aria-hidden="true">⤺</span>
        <span>
          {t("已压缩更早的上下文")}
          {Number.isFinite(n) ? tt("（约 {n} tokens）", " (~{n} tokens)", { n }) : ""}
        </span>
        <ChevronDown size={12} className="injection-chev" />
      </button>
      {open && summary && (
        <div className="compaction-body">
          <Markdown text={summary} />
        </div>
      )}
    </div>
  );
}

function StateDot({ state }: { state: "running" | "error" | "warning" | "ok" }) {
  return <span className={`state-dot ${state}`} aria-hidden="true" />;
}

/// Variant leading icons — DSH figma table (all glyphs render at 14 inside the
/// 16px leading box): search / read(browse) / bash(api) / write-edit(edit) /
/// code / question for unknown. Ported from ui-tool GenericToolCard.
/// Variant leading icons — 对齐官方 tool-call-model 的 TOOL_VARIANTS（figma 表，
/// 所有 glyph 在 16px 前导盒内按 14 渲染）：bash/pwsh → api；read 家族（含
/// web_fetch、read_image、cordis inspect）→ browse；search 家族（web_search/
/// grep/glob）→ search；write/edit → edit；run_code → code；skill → 专用图标；
/// 未分类（含 jobs/goal/subagent/ralph 等）→ sparkle。ask_user_question 保留
/// 问号：与等待回答行语义直接对应。
function ToolIcon({ name }: { name: string }) {
  switch (name) {
    case "bash":
    case "terminal-bash":
    case "pwsh":
      return <IconApiOutline14 size={14} />;
    case "write":
    case "edit":
    case "str_replace_editor":
    case "patch":
    case "multiedit":
    case "apply_patch":
      return <IconEditOutline16 size={14} />;
    case "read":
    case "read_file":
    case "file_read":
    case "read_image":
    case "web_fetch":
    case "fetch":
    case "cordis_package_inspect":
    case "cordis_runtime_inspect":
      return <IconBrowseOutline16 size={14} />;
    case "web_search":
    case "grep":
    case "glob":
    case "search":
      return <IconSearchOutline16 size={14} />;
    case "run_code":
    case "code":
    case "code_execute":
    case "code_interpreter":
      return <IconCodeOutline16 size={14} />;
    case "skill":
      return <IconSkillOutline16 size={14} />;
    case "ask_user_question":
    case "ask_user":
      return <IconQuestionOutline14 size={14} />;
    default:
      return <IconSparkle16 size={14} />;
  }
}

/// 文件语言徽标 — 文件工具行按扩展名显示彩色语言图标（DSH 编辑行同款）：
/// tsx/jsx 画 React 原子标，其余用 VS Code 风格的彩色缩写徽标。
const LANG_BADGES: Record<string, { bg: string; fg?: string; label: string }> = {
  ts: { bg: "#3178C6", label: "TS" },
  js: { bg: "#F7DF1E", fg: "#323330", label: "JS" },
  mjs: { bg: "#F7DF1E", fg: "#323330", label: "JS" },
  cjs: { bg: "#F7DF1E", fg: "#323330", label: "JS" },
  css: { bg: "#663399", label: "CSS" },
  scss: { bg: "#CF649A", label: "SCS" },
  less: { bg: "#2B5E91", label: "LES" },
  json: { bg: "#E8A33D", fg: "#26221E", label: "{}" },
  md: { bg: "#519ABA", label: "MD" },
  txt: { bg: "#6E7681", label: "TXT" },
  py: { bg: "#3572A5", label: "PY" },
  rs: { bg: "#CE4A2F", label: "RS" },
  go: { bg: "#00ADD8", label: "GO" },
  rb: { bg: "#CC342D", label: "RB" },
  php: { bg: "#777BB4", label: "PHP" },
  java: { bg: "#B07219", label: "JAVA" },
  swift: { bg: "#F05138", label: "SW" },
  vue: { bg: "#41B883", label: "VUE" },
  html: { bg: "#E34C26", label: "<>" },
  sh: { bg: "#89E051", fg: "#243018", label: "$" },
  bash: { bg: "#89E051", fg: "#243018", label: "$" },
  zsh: { bg: "#89E051", fg: "#243018", label: "$" },
  yml: { bg: "#CB171E", label: "YML" },
  yaml: { bg: "#CB171E", label: "YML" },
  toml: { bg: "#9C4221", label: "TML" },
  sql: { bg: "#DD6B20", label: "SQL" },
};

function ReactLangIcon() {
  return (
    <svg className="lang-badge" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#61DAFB" strokeWidth="1.4" aria-hidden="true">
      <circle cx="12" cy="12" r="2.1" fill="#61DAFB" stroke="none" />
      <ellipse cx="12" cy="12" rx="10" ry="4.2" />
      <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(120 12 12)" />
    </svg>
  );
}

function FileLangIcon({ file }: { file: string }) {
  const name = file.split(/[/\\]/).pop() ?? file;
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (ext === "tsx" || ext === "jsx") return <ReactLangIcon />;
  const badge = LANG_BADGES[ext];
  if (!badge) return null;
  return (
    <span className="lang-badge" style={{ background: badge.bg, color: badge.fg ?? "#FFFFFF" }} aria-hidden="true">
      {badge.label}
    </span>
  );
}

function ApprovalCard({ approvalId, rpcId, sessionId, toolName, reason }: { approvalId: string; rpcId?: string; sessionId: string; toolName: string; reason?: string }) {
  const [done, setDone] = useState(false);
  const answer = async (outcome: "allowed-once" | "rejected") => {
    if (!rpcId) return;
    try {
      await api.answerApproval({ rpcId, sessionId, approvalId, outcome });
      setDone(true);
    } catch {
      // ignore; card stays until approval/resolved
    }
  };
  return (
    <div className="approval-card">
      <div className="head">
        <ShieldCheck size={15} />
        {t("请求授权")}
      </div>
      <div className="cmd">{reason || toolName}</div>
      <div className="actions">
        <button className="btn-plain" disabled={done || !rpcId} onClick={() => void answer("rejected")}>
          <X size={13} style={{ verticalAlign: -2 }} /> {t("拒绝")}
        </button>
        <button className="btn-primary" disabled={done || !rpcId} onClick={() => void answer("allowed-once")}>
          {t("允许一次")}
        </button>
      </div>
    </div>
  );
}

/** 意图澄清卡片 — 官方 ui-user-questions QuestionComposer 的卡片化移植。
 *  单选题点击即锁定并推进（最后一题自动提交整批答案）；多选题勾选后用
 *  底部按钮推进；每题可跳过（selected: []）；关闭 = ASK_CANCELLED。
 *  应答回传请求信封上的 rpcId，卡片由 question/resolved 帧清除。 */
function QuestionCard({ rpcId, sessionId, questions }: {
  rpcId: string;
  sessionId: string;
  questions: Array<{ id: string; question: string; header?: string; detail?: string; options?: Array<{ label: string; description?: string }>; multiSelect?: boolean }>;
}) {
  const [page, setPage] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, { selected: string[]; custom?: string }>>({});
  const [custom, setCustom] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const q = questions[Math.min(page, questions.length - 1)];
  if (!q) return null;
  const multi = q.multiSelect === true;
  const options = q.options ?? [];
  const draft = drafts[q.id];
  const isLast = page >= questions.length - 1;

  const setDraft = (next: { selected: string[]; custom?: string }) => {
    setDrafts((prev) => ({ ...prev, [q.id]: next }));
  };

  const submitAll = async (final: Record<string, { selected: string[]; custom?: string }>) => {
    setSubmitting(true);
    try {
      await api.answerQuestion({
        rpcId,
        sessionId,
        answers: questions.map((item) => {
          const d = final[item.id] ?? { selected: [] };
          return { id: item.id, selected: d.selected, ...(d.custom ? { custom: d.custom } : {}) };
        }),
      });
      // 卡片由 question/resolved 帧负责移除；这里只防重复提交。
    } catch {
      setSubmitting(false); // 引擎不可达：留在卡片上可重试
    }
  };

  const advanceOrSubmit = async (next: { selected: string[]; custom?: string }) => {
    const final = { ...drafts, [q.id]: next };
    setDrafts(final);
    if (isLast) {
      await submitAll(final);
    } else {
      setCustom("");
      setPage((p) => p + 1);
    }
  };

  const pick = async (label: string) => {
    if (multi) {
      const sel = draft?.selected ?? [];
      const next = sel.includes(label) ? sel.filter((s) => s !== label) : [...sel, label];
      setDraft({ selected: next });
    } else {
      await advanceOrSubmit({ selected: [label] });
    }
  };

  const skip = () => void advanceOrSubmit({ selected: [] });
  const sendCustom = () => {
    const text = custom.trim();
    if (!text) return;
    void advanceOrSubmit(multi ? { selected: draft?.selected ?? [], custom: text } : { selected: [], custom: text });
  };
  const cancel = async () => {
    setSubmitting(true);
    try { await api.cancelQuestion(rpcId); } catch { setSubmitting(false); }
  };

  return (
    <div className="question-card">
      <div className="head">
        <IconQuestionOutline14 size={14} />
        {t("澄清一下")}
        {questions.length > 1 && <span className="pager">{page + 1}/{questions.length}</span>}
        <button className="q-close" title={t("取消提问")} disabled={submitting} onClick={() => void cancel()}>
          <X size={13} />
        </button>
      </div>
      {q.header && <div className="q-header">{q.header}</div>}
      <div className="q-text">{q.question}</div>
      {q.detail && <div className="q-detail">{q.detail}</div>}
      {options.length > 0 && (
        <div className="q-options">
          {options.map((o) => {
            const active = (draft?.selected ?? []).includes(o.label);
            return (
              <button
                key={o.label}
                className={`q-option${active ? " active" : ""}`}
                disabled={submitting}
                onClick={() => void pick(o.label)}
              >
                <span className="q-option-mark" aria-hidden="true" />
                <span className="q-option-body">
                  <span className="q-option-label">{o.label}</span>
                  {o.description && <span className="q-option-desc">{o.description}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="q-custom">
        <input
          placeholder={t("自定义回答…")}
          value={custom}
          disabled={submitting}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              sendCustom();
            }
          }}
        />
      </div>
      <div className="actions">
        <button className="btn-plain" disabled={submitting} onClick={skip}>
          {t("跳过此题")}
        </button>
        {multi && (
          <button
            className="btn-primary"
            disabled={submitting || (draft?.selected ?? []).length === 0}
            onClick={() => void advanceOrSubmit({ selected: draft?.selected ?? [], custom: custom.trim() || undefined })}
          >
            {isLast ? t("提交") : t("下一题")}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- derivations ----------
//
// Payload accessors are typed against SessionEvent's discriminated union, so
// `switch (event.type)` narrows `event.data` — no `as any`. Unknown event
// types fall through the default branch below.

function isTextBlock(b: ContentBlock | undefined): b is TextBlock {
  return !!b && (b as TextBlock).type === "text" && typeof (b as TextBlock).text === "string";
}

/// Plain text of an assistant/user message (text blocks only, never reasoning).
function messageText(content: ContentBlock[] | undefined): string {
  if (!Array.isArray(content)) return "";
  return content.filter(isTextBlock).map((b) => (b as TextBlock).text).join("");
}

/// Reasoning (think) text of an assistant message; null when absent.
function messageReasoning(content: ContentBlock[] | undefined): string | null {
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const b of content) {
    if (b && (b as ReasoningBlock).type === "reasoning" && typeof (b as ReasoningBlock).text === "string" && (b as ReasoningBlock).text) {
      parts.push((b as ReasoningBlock).text);
    }
  }
  return parts.length ? parts.join("\n\n") : null;
}

/// Text of a user/message event, honoring its `source.kind` (only real user
/// input is chat content; injected plugin/skill-catalog context is not).
function userText(d: UserMessageData): string {
  const kind = (d.source as { kind?: string })?.kind;
  if (kind !== "user" && kind !== undefined) return "";
  return messageText(d.content);
}

function textOf(event?: SessionEvent): string {
  if (!event) return "";
  switch (event.type) {
    case "user/message": return userText(event.data as UserMessageData);
    case "assistant/message": return messageText((event.data as AssistantMessageData).message?.content);
    default: return "";
  }
}

/** 注入消息全文（不看 source.kind——注入行展开体专用）。 */
function textOfInjection(event?: SessionEvent): string {
  if (!event || event.type !== "user/message") return "";
  return messageText((event.data as UserMessageData).content);
}

/// Text + reasoning split for an assistant message (render-time, from the
/// final event). Folds reasoning into the same assistant container (official
/// AssistantMarkdown) so it is never a separate duplicate row.
function blocksOf(event?: SessionEvent): { text: string; think: string | null } {
  if (!event) return { text: "", think: null };
  const content = event.type === "assistant/message" ? (event.data as AssistantMessageData).message?.content : undefined;
  return { text: messageText(content), think: messageReasoning(content) };
}

function toolCallIdOf(data: ToolCallData): string {
  return data.callId ?? data.id ?? "";
}

/// Read the stored args of a rendered tool-call item (for derived file path).
function extractArgsOf(out: RenderItem[], idx: number | undefined): string {
  return idx !== undefined && out[idx] ? out[idx].args ?? "" : "";
}

/// Derive an openable file path from a mutation tool's arguments (official
/// FILE_PATH_KEYS: path / file_path). Only write/edit/read variants produce one.
function derivePath(toolName: string, args: string): string | undefined {
  if (!/^(write|edit|read|str_replace_editor|file_read|file_write)$/.test(toolName)) return undefined;
  try {
    const p = JSON.parse(args);
    const picked = p?.path ?? p?.file_path;
    if (typeof picked === "string" && picked) return picked.split("\n")[0].trim();
  } catch { /* non-JSON args */ }
  return undefined;
}

function toolArgsString(argumentsField: unknown): string {
  if (typeof argumentsField === "string") return argumentsField;
  if (argumentsField === undefined || argumentsField === null) return "";
  try { return JSON.stringify(argumentsField, null, 2); } catch { return String(argumentsField); }
}

/// Pull the output text + failure + path from a tool/result payload (typed).
export function extractToolResult(data: ToolResultData): { callId?: string; output: string; failed: boolean; path?: string } {
  const msg = data.message;
  let output = "";
  const parts: string[] = [];
  const walk = (c: unknown) => {
    if (!c) return;
    if (typeof c === "string") { parts.push(c); return; }
    if (Array.isArray(c)) { c.forEach(walk); return; }
    if (typeof c === "object") {
      const o = c as Record<string, unknown>;
      if (typeof o.text === "string") parts.push(o.text);
      if (o.content !== undefined) walk(o.content);
    }
  };
  walk(msg?.content);
  if (parts.length) output = parts.join("\n");
  if (!output && typeof data.output === "string") output = data.output;
  if (!output && data.text) output = String(data.text);
  if (!output && data.result !== undefined) output = JSON.stringify(data.result);
  if (!output) output = truncate(JSON.stringify(data));
  const failed = data.isError === true || msg?.isError === true || data.ok === false;
  const callId = data.toolCallId ?? data.callId ?? msg?.source?.callId;
  const path = typeof data.path === "string" ? data.path : undefined;
  return { callId, output, failed, path };
}

/**
 * Ingest context passed through the append pass. Holds O(1) indexes keyed by
 * stable business id (call id, turn) instead of scanning the rendered array —
 * the official ConversationAssembler "hot append must not scan the window"
 * rule.
 */
export interface IngestCtx {
  timing: Map<number, { start?: number; end?: number; firstToken?: number; endSeq?: number }>;
  outputs: Map<string, { output: string; failed: boolean }>;
  produced: Map<number, string[]>;
  /** callId → rendered tool-call item index (stable identity). */
  callIndex: Map<string, number>;
  /** callId → derived file path (from tool/call arguments) for produced lanes. */
  callPaths: Map<string, string>;
  /** commandId → rendered command item index (run/done 配对，O(1) 定位). */
  commandIndex: Map<string, number>;
  /** retryId → rendered retry item index（同一等待去重更新）. */
  retryIndex: Map<string, number>;
  /** runId → rendered workflow item index（成员就地归并，O(1)）. */
  workflowIndex: Map<string, number>;
  /** turn → 轮终原因 / 累计用量（轮尾渲染）. */
  turnReason: Map<number, import("../types").TurnEndReason>;
  turnUsage: Map<number, import("../types").TokenUsage>;
  /** turn → the latest accumulated assistant text (copy-able tail payload). */
  turnText: Map<number, string>;
  /** turn → tail anchor time (the closing assistant message, if any). */
  turnTime: Map<number, number>;
}

/** Fresh ingest context — history replay, live mux passes and tests share one shape. */
export function makeIngestCtx(): IngestCtx {
  return { timing: new Map(), outputs: new Map(), produced: new Map(), callIndex: new Map(), callPaths: new Map(), commandIndex: new Map(), retryIndex: new Map(), workflowIndex: new Map(), turnReason: new Map(), turnUsage: new Map(), turnText: new Map(), turnTime: new Map() };
}

export function ingest(out: RenderItem[], entry: { event: SessionEvent; output?: string; view?: HistoryEntryView }, ctx: IngestCtx) {
  const ev = entry.event;
  const base = { key: `${ev.seq}:${ev.type}`, event: ev, time: ev.time };
  // `ev.data` is a union of every event payload (the trailing catch-all is
  // `unknown`), so a `type` switch does not auto-narrow it. Each branch casts
  // to its own payload type — the narrow, exhaustive case union does that work.
  switch (ev.type) {
    case "user/message": {
      const d = ev.data as UserMessageData;
      const txt = userText(d);
      if (txt) {
        out.push({ ...base, kind: "user" });
      } else {
        // 注入上下文（source.kind=plugin/skill-catalog…）：折叠行呈现，
        // 可展开看全文——不再整条过滤（PITFALLS §2.4 的升级形态）
        const label = (d.source as { kind?: string })?.kind;
        if (label) out.push({ ...base, kind: "injection", injectionLabel: label });
      }
      break;
    }
    case "turn/start": {
      const d = ev.data as { turn: number };
      ctx.timing.set(d.turn, { start: ev.time, end: undefined, firstToken: undefined });
      break;
    }
    case "turn/end": {
      const d = ev.data as { turn: number; reason: unknown };
      const t = ctx.timing.get(d.turn) ?? {};
      t.end = ev.time;
      t.endSeq = ev.seq;
      ctx.timing.set(d.turn, t);
      ctx.turnReason.set(d.turn, d.reason as import("../types").TurnEndReason);
      break;
    }
    case "assistant/chunk": {
      // Stream frames append chunk items for text-deltas; reasoning deltas
      // accumulate into a live trace item that the final assistant/message
      // replaces with the settled ThinkingState.
      const d = ev.data as { turn: number; step: number; chunk: StreamChunk };
      const chunk = d.chunk;
      if (chunk.type === "text-delta" && typeof chunk.text === "string" && chunk.text) {
        const turn = d.turn;
        const t0 = ctx.timing.get(turn);
        if (t0 && t0.firstToken === undefined) t0.firstToken = ev.time;
        const last = out[out.length - 1];
        if (last && last.kind === "chunk" && last.turn === turn) last.output = (last.output ?? "") + chunk.text;
        else out.push({ ...base, kind: "chunk", output: chunk.text, turn });
      }
      if (chunk.type === "reasoning-delta" && typeof chunk.text === "string" && chunk.text) {
        const turn = d.turn;
        const last = out[out.length - 1];
        if (last && last.kind === "reasoning" && last.turn === turn) last.output = (last.output ?? "") + chunk.text;
        else out.push({ ...base, kind: "reasoning", output: chunk.text, turn });
      }
      break;
    }
    case "assistant/message": {
      const d = ev.data as AssistantMessageData;
      const turn = d.turn;
      const text = messageText(d.message?.content);
      // Replace the live-streamed chunk/reasoning items for this step with
      // the final blocks. Discard them — re-appending interleaves stale
      // fragments.
      let cut = out.length - 1;
      while (cut >= 0 && (out[cut].kind === "chunk" || out[cut].kind === "reasoning") && out[cut].turn === turn) cut -= 1;
      out.length = cut + 1;
      // Track the accumulated tail payload.
      if (text) out.push({ ...base, kind: "assistant", turn });
      if (text) ctx.turnText.set(turn, text);
      if (d.usage) {
        // 多步轮按官方口径跨 step 求和（turn-metrics 的 fold 规则）
        const acc = ctx.turnUsage.get(turn) ?? {};
        const add = (a?: number, b?: number) => (a ?? 0) + (b ?? 0);
        ctx.turnUsage.set(turn, {
          inputTokens: add(d.usage.inputTokens, acc.inputTokens),
          outputTokens: add(d.usage.outputTokens, acc.outputTokens),
          cacheReadTokens: add(d.usage.cacheReadTokens, acc.cacheReadTokens),
          cacheWriteTokens: add(d.usage.cacheWriteTokens, acc.cacheWriteTokens),
          reasoningTokens: add(d.usage.reasoningTokens, acc.reasoningTokens),
        });
      }
      ctx.turnTime.set(turn, ev.time);
      break;
    }
    case "tool/call": {
      const d = ev.data as ToolCallData;
      const callId = toolCallIdOf(d);
      const args = d.arguments !== undefined ? toolArgsString(d.arguments) : d.argsRaw ?? d.command ?? "";
      const prev = ctx.callIndex.get(callId);
      if (prev !== undefined) {
        out[prev].args = args || out[prev].args;
      } else {
        const idx = out.length;
        out.push({
          ...base,
          kind: "tool-call",
          toolName: d.name ?? "tool",
          toolCallId: callId,
          args,
          turn: d.turn,
        });
        if (callId) ctx.callIndex.set(callId, idx);
      }
      // call 侧 diff 视图：引擎从 arguments 预推导的 pending 态变更
      const pendingDiffs = entry.view?.for === "call" && entry.view.view.card === "diff"
        ? narrowDiffs(entry.view.view.diffs)
        : null;
      if (pendingDiffs && prev !== undefined) out[prev].diffs = pendingDiffs;
      const p = derivePath(d.name ?? "tool", args);
      if (callId && p) ctx.callPaths.set(callId, p);
      break;
    }
    case "tool/result": {
      const d = ev.data as ToolResultData;
      const extracted = extractToolResult(d);
      const callId = extracted.callId ?? "";
      ctx.outputs.set(callId, { output: extracted.output, failed: extracted.failed });
      const prevIdx = ctx.callIndex.get(callId);
      // result 侧 diff 权威：事件 meta.diffs 优先，缺则用 history 视图槽位
      const appliedDiffs = narrowDiffs(d.meta?.diffs)
        ?? (entry.view?.for === "result" && entry.view.view.card === "diff" ? narrowDiffs(entry.view.view.diffs) : null);
      if (prevIdx !== undefined) {
        const item = out[prevIdx];
        if (item) {
          item.output = extracted.output;
          item.failed = extracted.failed;
          if (appliedDiffs) item.diffs = appliedDiffs;
        }
      }
      // produced files: successful mutation calls carrying a derived path
      if (!extracted.failed) {
        const filePath = ctx.callPaths.get(callId) ?? extracted.path ?? derivePath(prevIdx !== undefined ? out[prevIdx]?.toolName ?? "" : "", extractArgsOf(out, prevIdx));
        if (filePath) {
          const turn = d.turn ?? (prevIdx !== undefined ? out[prevIdx]?.turn : undefined) ?? -1;
          const list = ctx.produced.get(turn) ?? [];
          if (!list.includes(filePath)) {
            list.push(filePath);
            ctx.produced.set(turn, list);
          }
        }
      }
      break;
    }
    case "command/run": {
      const d = ev.data as import("../types").CommandRunData;
      const idx = out.length;
      out.push({
        ...base,
        kind: "command",
        commandId: d.commandId,
        toolName: d.name,
        args: d.args ?? "",
        commandStatus: "running",
      });
      if (d.commandId) ctx.commandIndex.set(d.commandId, idx);
      break;
    }
    case "command/done": {
      const d = ev.data as import("../types").CommandDoneData;
      const idx = ctx.commandIndex.get(d.commandId);
      if (idx !== undefined && out[idx]) {
        out[idx].commandStatus = d.kind;
        out[idx].commandText = d.text;
      }
      break;
    }
    case "compaction/summary": {
      const d = ev.data as import("../types").CompactionSummaryData;
      out.push({
        ...base,
        kind: "compaction",
        compactionId: d.compactionId,
        output: (d.summary ?? []).filter((b) => typeof b.text === "string").map((b) => b.text).join("\n\n"),
        args: d.shadowedTokenCount !== undefined ? String(d.shadowedTokenCount) : "",
      });
      break;
    }
    case "llm/retry": {
      const d = ev.data as import("../types").LlmRetryData;
      const prev = d.retryId ? ctx.retryIndex.get(d.retryId) : undefined;
      if (prev !== undefined && out[prev]) {
        out[prev].time = ev.time;
        out[prev].output = retryText(d);
      } else {
        const idx = out.length;
        out.push({ ...base, kind: "retry", retryId: d.retryId, output: retryText(d) });
        if (d.retryId) ctx.retryIndex.set(d.retryId, idx);
      }
      break;
    }
    case "tool-workflow/run-start":
    case "tool-workflow/agent-start":
    case "tool-workflow/agent-end":
    case "tool-workflow/run-end": {
      // 工作流运行卡（5.4）：run-start 开卡，成员按 seq 就地归并，run-end 定格
      const d = ev.data as import("../types").WorkflowRunStartData & Partial<import("../types").WorkflowAgentStartData & import("../types").WorkflowAgentEndData & import("../types").WorkflowRunEndData>;
      let idx = ctx.workflowIndex.get(d.runId);
      if (idx === undefined || !out[idx]) {
        idx = out.length;
        out.push({
          ...base,
          kind: "workflow",
          toolCallId: d.runId,
          args: ev.type === "tool-workflow/run-start" ? (ev.data as import("../types").WorkflowRunStartData).name : "",
        });
        ctx.workflowIndex.set(d.runId, idx);
      }
      const card = out[idx]!;
      if (ev.type === "tool-workflow/agent-start") {
        const s = ev.data as import("../types").WorkflowAgentStartData;
        card.members = card.members ?? [];
        card.members.push({ seq: s.seq, label: s.label, phase: s.phase, childId: s.childId, outcome: undefined });
        if (!card.args) card.args = s.label;
      } else if (ev.type === "tool-workflow/agent-end") {
        const e2 = ev.data as import("../types").WorkflowAgentEndData;
        card.members = card.members ?? [];
        const m = card.members.find((x) => x.seq === e2.seq);
        if (m) m.outcome = e2.outcome;
      } else if (ev.type === "tool-workflow/run-end") {
        card.commandStatus = (ev.data as import("../types").WorkflowRunEndData).stopReason === "completed" ? "success" : "error";
        card.commandText = (ev.data as import("../types").WorkflowRunEndData).stopReason;
      }
      break;
    }
    default:
      break;
  }
}

/** 重试行文本：延迟与次数 + 失败摘要（failure.code 优先，过长截断）。 */
function retryText(d: import("../types").LlmRetryData): string {
  const delay = d.delayMs !== undefined ? `${Math.round(d.delayMs / 1000)}s` : "";
  const attempt = d.maxRetries !== undefined ? `${d.retry}/${d.maxRetries}` : String(d.retry ?? "");
  const why = d.failure?.code ?? d.failure?.message ?? "";
  return [why, delay, attempt].filter(Boolean).join(" · ");
}

/**
 * Emit a per-turn tail item (meta + produced files). Official DSH renders a
 * `turn-tail` node per closed turn independent of whether the last block is
 * assistant text, so interrupted / tool-only turns keep their metrics+files.
 * Inserted right after the turn's last assistant item; a turn already having
 * a tail is updated in place.
 */
export function finalizeTurns(items: RenderItem[], ctx: IngestCtx) {
  const closed = [...ctx.timing.entries()].filter(([, t]) => t.start !== undefined && t.end !== undefined);
  if (closed.length === 0) return;
  // Build the tail payload per closed turn once.
  const tails = new Map<number, RenderItem>();
  for (const [turn, t] of closed) {
    const runMs = Math.max(0, (t.end ?? 0) - (t.start ?? 0));
    const ttftMs = t.firstToken !== undefined ? Math.max(0, t.firstToken - (t.start ?? 0)) : null;
    const tokensPerSecond = ttftMs !== null && runMs > ttftMs ? Math.round(((runMs - ttftMs) / 1000) * 100) / 100 : null;
    const txt = ctx.turnText.get(turn) ?? "";
    tails.set(turn, {
      key: `tail:${turn}`,
      kind: "turn-tail",
      turn,
      time: ctx.turnTime.get(turn),
      forkSeq: t.endSeq,
      event: txt
        ? ({ type: "assistant/message", seq: -1, time: ctx.turnTime.get(turn) ?? 0, data: { turn, step: 1, message: { role: "assistant", content: [{ type: "text", text: txt }], source: { kind: "model", provider: "", model: "" }, id: `tail:${turn}` } } } as SessionEvent)
        : undefined,
      meta: { runMs, ttftMs, tokensPerSecond },
      produced: ctx.produced.get(turn) ?? [],
      endReason: ctx.turnReason.get(turn),
      usage: ctx.turnUsage.get(turn),
    });
  }
  // Insert each turn's tail right after the LAST item belonging to that turn,
  // scanning left-to-right so earlier splices never invalidate a later anchor.
  // The live mux path re-finalizes on every turn/end, so a turn already
  // carrying a tail keeps it — re-emitting would duplicate every earlier tail.
  const order: RenderItem[] = [];
  const emitted = new Set<number>();
  const tailed = new Set(items.filter((it) => it.kind === "turn-tail").map((it) => it.turn));
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    order.push(item);
    const turn = item.turn;
    if (turn !== undefined) {
      // Is this the last item carrying this turn? The scan above exits either
      // at the array end (yes) or on the next item of the same turn (no).
      let j = i + 1;
      while (j < items.length && items[j].turn !== turn) j++;
      if (j >= items.length && tails.has(turn) && !emitted.has(turn) && !tailed.has(turn)) {
        order.push(tails.get(turn)!);
        emitted.add(turn);
      }
    }
    i++;
  }
  items.length = 0;
  items.push(...order);
}

/// Derived DSH-style tool summary from arguments (first line of the payload).
function summarizeArgs(args: string): string {
  if (!args) return "";
  try {
    const p = JSON.parse(args);
    if (p && typeof p === "object") {
      for (const key of ["command", "path", "file_path", "url", "query", "prompt", "code", "description", "message", "module"]) {
        if (typeof p[key] === "string" && p[key]) return firstLine(p[key]);
      }
      const keys = Object.keys(p);
      if (keys.length === 0) return "";
      const v = p[keys[0]];
      if (typeof v === "string" && v) return firstLine(v);
      return firstLine(args);
    }
    return typeof p === "string" ? firstLine(p) : "";
  } catch {
    return firstLine(args);
  }
}

function commandOf(args: string): string {
  try {
    const p = JSON.parse(args);
    if (typeof p?.command === "string") return p.command;
  } catch { /* fallthrough */ }
  return args;
}

function prettyArgs(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}

// ---------- formatting ----------

function basename(p: string): string {
  return p.split(/[/\\]/).pop() ?? p;
}

function firstLine(s: string): string {
  return s.split("\n")[0].trim();
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatRunDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return tt(`${total}秒`, `${total}s`);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return tt(`${m}分${s}秒`, `${m}m${s}s`);
}

function formatLatencySeconds(ms: number): string {
  const s = ms / 1000;
  return s >= 10 ? String(Math.round(s)) : (Math.round(s * 10) / 10).toString().replace(/\.0$/, "");
}

function formatTokensPerSecond(tps: number): string {
  return tps >= 100 ? String(Math.round(tps)) : tps >= 10 ? (Math.round(tps * 10) / 10).toString().replace(/\.0$/, "") : (Math.round(tps * 100) / 100).toString().replace(/\.0$/, "");
}

function truncate(s: string, n = 400): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

/** 排队消息文本（edit 仅支持文本，取 text 块拼接）。 */
function queueText(item: SessionQueuedItem): string {
  return item.message.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");
}

/** 排队消息卡（官方 QueueDock 式）：挂在会话框上方，行内 立即/编辑/删除。
 *  数据来自 store.queues（session/queue 帧），操作走 session.updateQueue，
 *  引擎应用后广播新快照，卡片随之刷新。 */
function QueueDock({ sessionId, items }: { sessionId: string; items: SessionQueuedItem[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const mutate = async (itemId: string, action: Parameters<typeof api.updateQueue>[0]["action"]) => {
    try {
      await api.updateQueue({ sessionId, itemId, action });
    } catch (err) {
      alert(tt("排队消息操作失败：{m}", "Queue update failed: {m}", { m: (err as Error).message }));
    }
  };
  const saveEdit = (itemId: string) => {
    if (!draft.trim()) return;
    void mutate(itemId, { kind: "edit", content: [{ type: "text", text: draft.trim() }] });
    setEditingId(null);
  };
  return (
    <div className="queue-dock">
      {items.map((item) => {
        const text = queueText(item);
        const editing = editingId === item.id;
        return (
          <div className="queue-row" key={item.id}>
            <span className="queue-handle" aria-hidden="true"><GripVertical size={13} /></span>
            {editing ? (
              <>
                <input
                  className="queue-edit"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit(item.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
                <div className="queue-actions">
                  <button className="queue-btn" title={t("保存排队消息")} onClick={() => saveEdit(item.id)}>
                    <IconCheckOutline16 size={14} />
                  </button>
                  <button className="queue-btn" title={t("取消编辑")} onClick={() => setEditingId(null)}>
                    <X size={14} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="queue-text" title={text}>{text}</span>
                <div className="queue-actions">
                  <button className="queue-now" title={t("立即插队执行")} onClick={() => void mutate(item.id, { kind: "steer" })}>
                    <ArrowUp size={13} />
                    {t("立即")}
                  </button>
                  <button className="queue-btn" title={t("编辑排队消息")} onClick={() => { setEditingId(item.id); setDraft(text); }}>
                    <Pencil size={13} />
                  </button>
                  <button className="queue-btn" title={t("删除排队消息")} onClick={() => void mutate(item.id, { kind: "remove" })}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
