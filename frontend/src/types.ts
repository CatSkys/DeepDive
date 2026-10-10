/// <reference types="vite/client" />

// wire 契约的兼容再导出层（M0，docs/WIRE-V1.md）：v1 契约已迁至 wire/
// （信封身份 ./wire/v1、会话事件词表 ./wire/sessionEvents、面板与交互
// ./wire/panels、归一化 ./wire/normalize）——既有导入点（../types）保持
// 不改；新代码直接从 wire/ 取。
export { WIRE_VERSION } from "./wire/v1";
export type { RpcResult, SessionAddress, SessionSummary, WorkspaceView } from "./wire/v1";
export type {
  TextBlock, ReasoningBlock, ToolCallBlock, ImageAttachmentBlock, ContentBlock,
  UserMessageData, AssistantMessageData, StreamChunk,
  AssistantStreamFrame, AssistantStreamBaseline,
  ToolCallData, ToolResultData, FileDiff, TurnEndReason, PresentedFile,
  SessionEvent, HistoryEntry,
  CommandRunData, CommandDoneData, CompactionSummaryData, LlmRetryData,
  WorkflowRunStartData, WorkflowAgentStartData, WorkflowAgentEndData, WorkflowRunEndData,
  ScheduleChangeData, ScheduleRecord, TokenUsage,
} from "./wire/sessionEvents";
export type {
  ApprovalPending, QuestionPending, QuestionOption, QuestionItem, QuestionAnswerItem,
  SessionQueuedItem, PromptContentPart,
  CommandDescriptor, CommandSubmitAttachment, CommandExecution,
  JobView, GitStatus, SubagentListEntry, GoalProjection,
} from "./wire/panels";
