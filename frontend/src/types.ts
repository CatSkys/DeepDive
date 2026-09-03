/// <reference types="vite/client" />

// ---------- wire contracts (rc.2 /api gateway, from dsh-client-connection) ----------

export interface RpcResult<T = unknown> {
  ok: boolean;
  value?: T;
  error?: { code?: string; message?: string };
}

export interface SessionSummary {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  parentSessionId?: string;
  origin?: "subagent";
  cwd?: string;
  agentPreset?: string;
  projections?: { asOfSeq: number; values: Record<string, unknown> };
}

export interface WorkspaceView {
  workspaceId: string;
  path: string;
  title: string;
  sessionIds: string[];
  createdAt: string;
  updatedAt: string;
}

// ---------- Session events: discriminated union on `type` ----------
// Mirrors official dsh SessionEventMap members we consume. `data` narrows by
// `type`, so `switch (event.type)` is exhaustive per event — no `as any`.
// Extra engine fields are tolerated (union is merge-extensible), but the ones
// we read are declared here.

export type TextBlock = { type: "text"; text: string };
export type ReasoningBlock = { type: "reasoning"; text: string };
export type ToolCallBlock = { type: "tool-call"; id: string; name: string; arguments: string | unknown };
export type ContentBlock = TextBlock | ReasoningBlock | ToolCallBlock | { type: string; [k: string]: unknown };

export interface UserMessageData {
  content: ContentBlock[];
  role: "user";
  source: { kind: string; rpcId?: string };
  id: string;
}

export interface AssistantMessageData {
  turn: number;
  step: number;
  message: {
    role: "assistant";
    content: ContentBlock[];
    source: { kind: "model"; provider: string; model: string };
    id: string;
  };
  usage?: TokenUsage;
}

export type StreamChunk =
  | { type: "text-delta"; index: number; text: string }
  | { type: "reasoning-delta"; index: number; text: string }
  | { type: "block-start"; index: number; blockType: string }
  | { type: "block-end"; index: number; block: { type: string; text?: string } }
  | { type: "usage"; usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; reasoningTokens?: number } }
  | { type: "finish"; reason: { kind: string } }
  | { type: string; [k: string]: unknown };

export interface ToolCallData {
  turn: number;
  step: number;
  callId: string;
  name: string;
  arguments: string | unknown;
  // tolerated cross-version fields (engine may emit these instead)
  id?: string;
  toolName?: string;
  argsRaw?: string;
  command?: string;
}

export interface ToolResultData {
  turn: number;
  step: number;
  message?: {
    source?: { kind: string; callId?: string };
    content?: ContentBlock[];
    isError?: boolean;
  };
  output?: string;
  text?: string;
  result?: unknown;
  path?: string;
  isError?: boolean;
  /** 编辑类工具的结果槽位：本次调用应用的文件变更（docs/DSH-WIRE.md §3.4）。 */
  meta?: { diffs?: FileDiff[] };
  // tolerated cross-version fields
  toolCallId?: string;
  callId?: string;
  ok?: boolean;
}

/** 一次文件变更（官方 FileDiff/DiffHunk 同形）：oldText=null 表示新建/覆盖无前文。 */
export interface FileDiff {
  path: string;
  oldText: string | null;
  newText: string;
}

/** turn/end 的 data.reason（rc.2 实测为对象形，docs/DSH-WIRE.md §3.1）。 */
export type TurnEndReason =
  | { kind: "completed" }
  | { kind: "interrupted" }
  | { kind: "aborted"; reason?: { kind: string } }
  | { kind: "max-tokens" }
  | { kind: "error"; error?: { message?: string; code?: string } }
  | { kind: string; [k: string]: unknown };

export type SessionEvent =
  | { type: "turn/start"; seq: number; time: number; data: { turn: number }; sourceEventSeqs?: number[]; surfaceOp?: unknown }
  | { type: "turn/end"; seq: number; time: number; data: { turn: number; reason: TurnEndReason }; sourceEventSeqs?: number[]; surfaceOp?: unknown }
  | { type: "step/start"; seq: number; time: number; data: { turn: number; step: number }; sourceEventSeqs?: number[]; surfaceOp?: unknown }
  | { type: "step/end"; seq: number; time: number; data: { turn: number; step: number }; sourceEventSeqs?: number[]; surfaceOp?: unknown }
  | { type: "user/message"; seq: number; time: number; data: UserMessageData; sourceEventSeqs?: number[]; surfaceOp?: unknown }
  | { type: "assistant/chunk"; seq: number; time: number; data: { turn: number; step: number; chunk: StreamChunk }; sourceEventSeqs?: number[]; surfaceOp?: unknown }
  | { type: "assistant/message"; seq: number; time: number; data: AssistantMessageData; sourceEventSeqs?: number[]; surfaceOp?: unknown }
  | { type: "tool/call"; seq: number; time: number; data: ToolCallData; sourceEventSeqs?: number[]; surfaceOp?: unknown }
  | { type: "tool/result"; seq: number; time: number; data: ToolResultData; sourceEventSeqs?: number[]; surfaceOp?: unknown }
  | { type: "command/run"; seq: number; time: number; data: CommandRunData; sourceEventSeqs?: number[]; surfaceOp?: unknown }
  | { type: "command/done"; seq: number; time: number; data: CommandDoneData; sourceEventSeqs?: number[]; surfaceOp?: unknown }
  | { type: "compaction/summary"; seq: number; time: number; data: CompactionSummaryData; sourceEventSeqs?: number[]; surfaceOp?: unknown }
  | { type: "llm/retry"; seq: number; time: number; data: LlmRetryData; sourceEventSeqs?: number[]; surfaceOp?: unknown }
  | { type: "tool-workflow/run-start"; seq: number; time: number; data: WorkflowRunStartData; sourceEventSeqs?: number[]; surfaceOp?: unknown }
  | { type: "tool-workflow/agent-start"; seq: number; time: number; data: WorkflowAgentStartData; sourceEventSeqs?: number[]; surfaceOp?: unknown }
  | { type: "tool-workflow/agent-end"; seq: number; time: number; data: WorkflowAgentEndData; sourceEventSeqs?: number[]; surfaceOp?: unknown }
  | { type: "tool-workflow/run-end"; seq: number; time: number; data: WorkflowRunEndData; sourceEventSeqs?: number[]; surfaceOp?: unknown }
  | { type: "schedule/change"; seq: number; time: number; data: ScheduleChangeData; sourceEventSeqs?: number[]; surfaceOp?: unknown }
  | { type: string; seq: number; time: number; data: unknown; sourceEventSeqs?: number[]; surfaceOp?: unknown; ignorable?: boolean };

/** mux 下行帧的投影推送（goal 等键的实时整值）。 */
export interface ProjectionFrame {
  type: "session/projection";
  sessionId: string;
  key: string;
  value: unknown;
  seq: number;
}

/** mux 下行帧的后台任务快照（每次变化全量 jobs）。 */
export interface JobsFrame {
  type: "session/jobs";
  sessionId: string;
  jobs: JobView[];
}

/** 斜杠命令生命周期（docs/DSH-WIRE.md §3.5）；run/done 以 commandId 配对。 */
export interface CommandRunData {
  commandId: string;
  name: string;
  args?: string;
  source?: { kind: string };
}

export interface CommandDoneData {
  commandId: string;
  kind: "success" | "error";
  text?: string;
  sourceEventSeq?: number;
}

/* ── 阶段 3 信息面事件（载荷形状出处 docs/DSH-WIRE.md §3.6/§3.7）── */

/** compaction/summary：压缩完成卡（summary 为 ContentBlock[]，渲染取 text 块）。 */
export interface CompactionSummaryData {
  compactionId: string;
  summary?: Array<{ type: string; text?: string }>;
  shadowedTokenCount?: number;
  provider?: string;
  model?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** llm/retry：一次提供商路由重试等待的持久记录。 */
export interface LlmRetryData {
  retryId: string;
  turn?: number;
  step?: number;
  provider?: string;
  mode?: "normal" | "always";
  retry: number;
  maxRetries?: number;
  delayMs?: number;
  failure?: { message?: string; code?: string; status?: number };
}

/* ── 阶段 5：长任务与并行工作面（载荷出处 docs/DSH-WIRE.md §7）── */

/** goal 投影值（goal/change 全值 last-wins；CAS 修订在其 goal.revision 上）。 */
export interface GoalProjection {
  goal: {
    id: string;
    revision: number;
    objective: string;
    phase: "active" | "paused" | "blocked" | "complete";
    blockedReason?: { code: string; message: string };
    maxGoalRounds: number;
  };
  roundsStarted: number;
  createdAt: number;
  updatedAt: number;
}

/** session/jobs 帧的单条后台任务视图。 */
export interface JobView {
  id: string;
  kind: string;
  label: string;
  status: "running" | "stopping" | "completed" | "killed" | "failed";
  detail?: string;
  startedAt: number;
  finishedAt?: number;
}

/** subagent.list 的单条目（谱系树；diagnostic 为坏账行）。 */
export type SubagentListEntry =
  | {
    kind: "child";
    id: string;
    activity: "running" | "inactive";
    hasChildren: boolean;
    mode: "one-shot" | "continuable";
    label?: string;
  }
  | { kind: "diagnostic"; id: string; reason: "corrupt" | "unsupported" | "unavailable" };

/** tool-workflow/*：工作流运行记录（父会话事件流内的嵌套卡数据）。 */
export interface WorkflowRunStartData {
  runId: string;
  name: string;
}
export interface WorkflowAgentStartData {
  runId: string;
  seq: number;
  label: string;
  phase?: string;
  childId?: string;
}
export interface WorkflowAgentEndData {
  runId: string;
  seq: number;
  outcome: "completed" | "failed" | "cancelled";
}
export interface WorkflowRunEndData {
  runId: string;
  stopReason: "completed" | "cancelled" | "error";
}

/** schedule/change：会话本地提醒的版本化变更（v1）。 */
export type ScheduleChangeData =
  | { version: 1; operation: "create"; schedule: ScheduleRecord }
  | { version: 1; operation: "delete"; id: string }
  | { version: 1; operation: "dispatch"; id: string }
  | { version: 1; operation: "advance"; id: string; scheduledAt: string };

export interface ScheduleRecord {
  id: string;
  kind: "after" | "at" | "every";
  prompt: string;
  /** kind=at/every：RFC 3339 UTC 目标时间。 */
  scheduledAt?: string;
  /** kind=every：固定间隔秒（≥300）。 */
  everySeconds?: number;
  /** kind=after：相对秒。 */
  delaySeconds?: number;
}

/** 轮的 token 用量（usage 字段，rc.2 实测形状）。 */
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export interface ApprovalRequestFrame {
  type: "approval/requested";
  sessionId: string;
  approvalId: string;
  toolName: string;
  callId?: string;
  reason?: string;
}

export interface ApprovalResolvedFrame {
  type: "approval/resolved";
  sessionId: string;
  approvalId: string;
  outcome: "allowed-once" | "rejected" | "cancelled" | "unavailable";
}

/* ── 用户提问（ask_user_question）线路契约，对照 apiproxy 引擎源码 ──
   question/requested 以 server-request 信封推送（rpcId 在信封上，应答时
   必须原样回传）；value 走 /api/respond：{sessionId, answer:{answers}}。 */

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionItem {
  id: string;
  question: string;
  header?: string;
  detail?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
  intent?: { kind: "plan-review"; approve: string };
}

export interface QuestionAnswerItem {
  id: string;
  selected: string[];
  custom?: string;
}

export interface QuestionRequestedFrame {
  type: "question/requested";
  sessionId: string;
  questions: QuestionItem[];
}

export interface QuestionResolvedFrame {
  type: "question/resolved";
  sessionId: string;
  questionRpcId: string;
  outcome: "answered" | "cancelled";
}

/* ── 排队消息（pending inbox）线路契约，对照引擎源码 ──
   session/queue 帧由 events.mux 广播（每变化一次全量 items）；操作走
   session.updateQueue unary：{sessionId, itemId, action}，action = edit
   （仅文本）/ remove / steer（=立即插队）。 */

export interface SessionQueuedItem {
  id: string;
  placement: "queued" | "steering" | "context";
  /** 排队消息 user source 上的 Prompt-RPC 身份。 */
  rpcId?: string;
  message: {
    id: string;
    content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  };
}

export type MuxFrame =
  | { type: "session/event"; sessionId: string; event: SessionEvent }
  | { type: "session/subscribed"; sessionId: string; lastSeq: number }
  | { type: "session/queue"; sessionId: string; items: SessionQueuedItem[] }
  | ProjectionFrame
  | JobsFrame
  | ApprovalRequestFrame
  | ApprovalResolvedFrame
  | QuestionRequestedFrame
  | QuestionResolvedFrame
  | { type: string; [k: string]: unknown };

/* ── session.prompt 的 content 分块（引擎 wire：文本在前、图像附件在后）── */

export type PromptContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string; name?: string };

export interface HistoryEntry {
  event: SessionEvent;
  view?: HistoryEntryView;
}

/** 引擎在 history 条目上预计算的工具呈现卡（docs/DSH-WIRE.md §3.4）：
 *  `card:'diff'` 携带引擎从 arguments/结果推导的 FileDiff，call 侧即
 *  pending 态 diff，result 侧为已应用的权威 diff。 */
export interface HistoryEntryView {
  for: "call" | "result";
  view: { card: string; diffs?: FileDiff[]; [k: string]: unknown };
}
