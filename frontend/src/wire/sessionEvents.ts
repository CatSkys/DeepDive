// wire v1 契约 · 会话事件词表（M0，docs/WIRE-V1.md §3/§4）：联合在 `type` 上
// 可辨识，`data` 按分支收窄——渲染层 `switch (event.type)` 逐分支穷举。
// v1 是规范形状：A（dsh）的备选拼写（tool/call 的 id/toolName/argsRaw、
// tool/result 的 toolCallId/callId/ok 等）由 ./normalize 在边界处收敛，这里
// 只声明 canonical 字段。未知事件类型由尾部 catch-all 成员原样透传。

export type TextBlock = { type: "text"; text: string };
export type ReasoningBlock = { type: "reasoning"; text: string };
export type ToolCallBlock = { type: "tool-call"; id: string; name: string; arguments: string | unknown };
/** 用户消息里的图片块：attachment 引用，字节经 session/attachment 取。 */
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

/* ── 直播流（assistant-stream 帧，session/follow 的进程级帧）──
   持久日志只落 settlement（assistant/message / assistant/attempt），流式
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
}

export interface ToolResultData {
  turn: number;
  step: number;
  message?: {
    source?: { kind: string; callId?: string };
    content?: ContentBlock[];
    isError?: boolean;
  };
  path?: string;
  /** 编辑类工具的结果槽位：本次调用应用的文件变更（docs/DSH-WIRE.md §3.4）。 */
  meta?: { diffs?: FileDiff[] };
}

/** 一次文件变更（官方 FileDiff/DiffHunk 同形）：oldText=null 表示新建/覆盖无前文。 */
export interface FileDiff {
  path: string;
  oldText: string | null;
  newText: string;
}

/** turn/end 的 data.reason（对象形，docs/DSH-WIRE.md §3.1）。 */
export type TurnEndReason =
  | { kind: "completed" }
  | { kind: "interrupted" }
  | { kind: "aborted"; reason?: { kind: string } }
  | { kind: "max-tokens" }
  | { kind: "error"; error?: { message?: string; code?: string } }
  | { kind: string; [k: string]: unknown };

/** present 工具声明的交付文件：path 是绝对路径或**相对会话工作目录**的路径（官方
 *  PresentedFile 同款），description 由模型给出、可缺省。 */
export interface PresentedFile {
  path: string;
  description?: string;
}

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
  | { type: "deliverables/presented"; seq: number; time: number; data: { turn: number; callId: string; files: PresentedFile[] }; sourceEventSeqs?: number[]; surfaceOp?: unknown }
  | { type: string; seq: number; time: number; data: unknown; sourceEventSeqs?: number[]; surfaceOp?: unknown; ignorable?: boolean };

/** 会话日志条目：wire 只有事件本身；工具呈现卡由客户端从调用参数推导。 */
export interface HistoryEntry {
  event: SessionEvent;
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

/* ── 信息面事件（docs/DSH-WIRE.md §3.6/§3.7）── */

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

/** schedule/change：会话本地提醒的版本化变更。 */
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
  afterSeconds?: number;
}

/** 轮的 token 用量。 */
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}
