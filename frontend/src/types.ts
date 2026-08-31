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
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; reasoningTokens?: number };
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
  // tolerated cross-version fields
  toolCallId?: string;
  callId?: string;
  ok?: boolean;
}

export type TurnEndReason = "completed" | "cancelled" | "failed" | "interrupted" | string;

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
  | { type: string; seq: number; time: number; data: unknown; sourceEventSeqs?: number[]; surfaceOp?: unknown; ignorable?: boolean };

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

export type MuxFrame =
  | { type: "session/event"; sessionId: string; event: SessionEvent }
  | { type: "session/subscribed"; sessionId: string; lastSeq: number }
  | ApprovalRequestFrame
  | ApprovalResolvedFrame
  | { type: string; [k: string]: unknown };

export interface HistoryEntry {
  event: SessionEvent;
  view?: { for: "call" | "result"; view: { card?: string } };
}
