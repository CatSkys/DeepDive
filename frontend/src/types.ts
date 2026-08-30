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

export interface SessionEvent {
  type: string;
  seq: number;
  time: number;
  data: any;
  sourceEventSeqs?: number[];
  surfaceOp?: unknown;
  ignorable?: boolean;
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
