import type { HistoryEntry, MuxFrame, RpcResult, SessionSummary, WorkspaceView } from "./types";

// Same-origin bridge (/api → engine). The bridge forward hop carries no
// browser Origin, which the engine trust fence accepts.

async function unary<T = unknown>(method: string, payload: unknown = {}): Promise<T> {
  const res = await fetch("/api/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "client-request",
      rpcId: crypto.randomUUID(),
      method,
      payload,
    }),
  });
  if (!res.ok) throw new Error(`transport: ${method} HTTP ${res.status}`);
  const full: { rpcId: string; result: RpcResult<T> } = await res.json();
  if (!full.result.ok) {
    const err = full.result.error;
    throw new Error(`${err?.code ?? "rpc"}: ${err?.message ?? "unknown"}`);
  }
  return full.result.value as T;
}

async function respond(message: unknown): Promise<void> {
  const res = await fetch("/api/respond", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error(`respond HTTP ${res.status}`);
}

export const api = {
  workspaces: () => unary<{ items: WorkspaceView[]; archivedSessionIds: string[] }>("workspace.list"),
  sessions: () => unary<{ items: SessionSummary[] }>("session.list"),
  createSession: (payload: { workspaceId?: string; cwd?: string; sessionId?: string }) =>
    unary<{ sessionId: string; agentPreset?: string }>("session.create", payload),
  history: (payload: { sessionId: string; atSeq?: number; maxMessages?: number }) =>
    unary<{ events: HistoryEntry[]; hasMore: boolean }>("session.history", payload),
  prompt: (payload: { sessionId: string; mode: "queue" | "steer"; content: Array<{ type: string; text?: string; image?: unknown }> }) =>
    unary<{ accepted: true; command?: { kind: string; text?: string } }>("session.prompt", payload),
  cancel: (payload: { sessionId: string }) => unary("session.cancel", payload),
  rename: (payload: { sessionId: string; title: string }) => unary("session.rename", payload),
  search: (payload: { query: string }) => unary("session.search", payload),
  answerApproval: (value: { approvalId: string; outcome: "allowed-once" | "rejected" }) =>
    respond({ type: "client-response", rpcId: crypto.randomUUID(), result: { ok: true, value } }),
  agentPresets: () =>
    unary<{ items: Array<{ id: string; name: string; description?: string; user?: boolean }> }>("agentPreset.list", {}),
  llmModels: () => unary<{ groups: Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }> }>("llm.models", {}),
  openMux: (onFrame: (frame: MuxFrame) => void, onOpen: () => void) => openMux(onFrame, onOpen),
};

/** Engine mux is a WebSocket of `server-request` wrapper frames; the payload
 *  is the logical frame (session/event, approval/requested, …). */
function openMux(onFrame: (frame: MuxFrame) => void, onOpen: () => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry: number | null = null;

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(`ws://${location.host}/api/events.mux`);
    ws.onopen = () => onOpen();
    ws.onmessage = (e) => {
      try {
        const raw = JSON.parse(String(e.data));
        const frame = (raw && raw.payload) || raw;
        onFrame(frame);
      } catch {
        // one corrupt frame must not kill the stream
      }
    };
    ws.onclose = () => {
      if (!closed) retry = window.setTimeout(connect, 2000);
    };
    ws.onerror = () => {
      ws?.close();
    };
  };
  connect();

  return () => {
    closed = true;
    if (retry !== null) window.clearTimeout(retry);
    ws?.close();
  };
}
