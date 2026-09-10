/// <reference types="vite/client" />

// ---------- wire contracts (0.1.2 /api gateway，vendored packages/client/connection) ----------

export interface RpcResult<T = unknown> {
  ok: boolean;
  value?: T;
  error?: { code?: string; message?: string };
}

/** 会话持久地址（session/follow、session/page 共用）：普通会话或 subagent 子址。 */
export type SessionAddress =
  | { kind: "session"; sessionId: string }
  | { kind: "subagent"; parentSessionId: string; childSessionId: string; mode: "one-shot" | "continuable" };

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
/** 用户消息里的图片块（rc.2 实测）：attachment 引用，字节经 session.attachment 取。 */
export type ImageAttachmentBlock = {
  type: "image";
  attachment: { attachmentId: string; mediaType: string; width?: number; height?: number; bytes?: number; name?: string };
};
export type ContentBlock = TextBlock | ReasoningBlock | ToolCallBlock | ImageAttachmentBlock | { type: string; [k: string]: unknown };

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

export type StreamChunk =  | { type: "text-delta"; index: number; text: string }
  | { type: "reasoning-delta"; index: number; text: string }
  | { type: "block-start"; index: number; blockType: string }
  | { type: "block-end"; index: number; block: { type: string; text?: string } }
  | { type: "usage"; usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; reasoningTokens?: number } }
  | { type: "finish"; reason: { kind: string } }
  | { type: string; [k: string]: unknown };

/* ── 0.1.5 直播流（assistant-stream 帧，session-controller types）──
   V3 日志只落 settlement（assistant/message / assistant/attempt），流式
   增量改走 follow 流的进程级帧（开流须带 assistantStream:true）；重连由
   快照 assistantStream 基线（已累计的 {time,chunk} 数组）续播。 */
export type AssistantStreamFrame =
  | { type: "start"; attemptId: string; revision: number; startedAfterSeq?: number; turn: number; step: number }
  | { type: "chunk"; attemptId: string; revision: number; index: number; time: number; chunk: StreamChunk }
  | { type: "end"; attemptId: string; revision: number; index: number; outcome:
      | { kind: "committed"; eventType: "assistant/message" | "assistant/attempt"; seq: number }
      | { kind: "abandoned" } };

export interface AssistantStreamBaseline {
  revision: number;
  activeAttempt?: {
    attemptId: string;
    startedAfterSeq?: number;
    turn: number;
    step: number;
    nextIndex: number;
    stream: Array<{ time: number; chunk: StreamChunk }>;
  };
}

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

/** mux 下行已随 0.1.2 改流化（api.ts ControlFrame/WorkspaceFollowFrame）；
 *  审批/提问以 $events waterfall 帧到达，身份 = eventId（应答也用它）。 */

/** 挂起审批（waterfall `approval/request`；request = {toolName, callId?, reason?}）。 */
export interface ApprovalPending {
  eventId: string;
  sessionId: string;
  toolName: string;
  callId?: string;
  reason?: string;
}

/** 挂起提问（waterfall `user-questions/request`；questions 首条带提问文本）。 */
export interface QuestionPending {
  eventId: string;
  sessionId: string;
  questions: QuestionItem[];
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

/**
 * turnOutline 投影条目（引擎 session-turn-outline：wire 值为裸数组，按 turn
 * 严格递增）。`seq` 是该轮 turn/start 的事件 seq——向前翻页覆盖到它即得整轮；
 * prompt/response 是引擎侧预算过的预览（50/120 字符）。
 */
export interface TurnOutlineEntry {
  turn: number;
  seq: number;
  prompt: string;
  response: string;
}

/** commands/list 条目（引擎 interaction/commands CommandDescriptor，name 排序）。 */
export interface CommandDescriptor {
  /** 无斜杠小写命令名（引擎 parseCommand 同名）。 */
  name: string;
  description: string;
  /** 存在即表示命令吃自由输入：hint 是占位提示；images=true 才接受图片。 */
  input?: { hint: string; images?: boolean };
}

/**
 * commands/execute 回包（undefined = 未知/畸形命令，引擎不落任何事件）。
 * 转录节点来自 command/run + command/done 会话事件（按 commandId 配对），
 * 回包只用于提交侧的成败裁决。
 */
export interface CommandExecution {
  commandId: string;
  result: { kind: "success"; text?: string; sourceEventSeq?: number } | { kind: "error"; text: string };
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

/** 壳层 run-git 的聚合回包（工作区未提交改动；非 git 仓库 repo=false）。 */
export interface GitStatus {
  repo: boolean;
  branch?: string;
  files: number;
  additions: number;
  deletions: number;
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
  /** kind=after：相对秒（rc.2 实测字段名）。 */
  afterSeconds?: number;
}

/** 轮的 token 用量（usage 字段，rc.2 实测形状）。 */
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

/* ── 用户提问（ask_user_question）线路契约 ──
   0.1.2：以 $events waterfall（`user-questions/request`）推送，应答按 eventId
   经 $events/result 回 {answers:[{id, selected, custom?}]}。 */

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

/* ── 排队消息（pending inbox）线路契约 ──
   0.1.2：队列快照走 session/control 流（每变化一次全量 items）；操作走
   session/updateQueue unary：{sessionId, itemId, action}，action = edit
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

/* ── session.prompt 的 content 分块（引擎 wire：文本在前、图像附件在后）── */

export type PromptContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string; name?: string };

/** 会话日志条目（0.1.2：wire 只有事件本身；工具呈现卡由客户端从调用参数
 *  推导，不再有引擎预计算的 view 槽位）。 */
export interface HistoryEntry {
  event: SessionEvent;
}
