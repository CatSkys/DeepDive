import type { HistoryEntry, MuxFrame, RpcResult, SessionSummary, WorkspaceView } from "./types";

// Same-origin bridge (/api → engine). Verified wire contract for the pinned
// 0.1.2-alpha.2 runtime (see docs/PITFALLS.md §4.6 — audited against the
// engine's own UNARY_ROUTES, do not guess):
//   POST /api/<dot-form method>  +  envelope { type:"client-request",
//   rpcId, method (must equal the path-derived name), payload: <flat params> }
// Live events ride the broadcast /api/events.mux WebSocket downlink (openMux
// below). There is no /api/remote.mux Gateway stream in this build.

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
  createSession: (payload: { workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string }) =>
    unary<{ sessionId: string; agentPreset?: string }>("session.create", payload),
  history: (payload: { sessionId: string; atSeq?: number; maxMessages?: number }) =>
    // alpha.2 names the page anchor `beforeSeq`; callers keep the rc.2-era
    // `atSeq` spelling — mapped here so SessionView stays untouched.
    unary<{ events: HistoryEntry[]; hasMore: boolean }>("session.history", {
      sessionId: payload.sessionId,
      beforeSeq: payload.atSeq,
      maxMessages: payload.maxMessages,
    }),
  prompt: (payload: { sessionId: string; mode: "queue" | "steer"; content: Array<{ type: string; text?: string; image?: unknown }> }) =>
    unary<{ accepted: true; command?: { kind: string; text?: string } }>("session.prompt", payload),
  cancel: (payload: { sessionId: string }) => unary("session.cancel", payload),
  answerApproval: (value: { approvalId: string; outcome: "allowed-once" | "rejected" }) =>
    respond({ type: "client-response", rpcId: crypto.randomUUID(), result: { ok: true, value } }),
  agentPresets: () =>
    unary<{ presets: Array<{ id: string; name: string; description?: string; trust?: string; isDefault?: boolean }> }>("agentPreset.list", {}),
  sessionModels: (payload: { sessionId: string }) =>
    unary<{ current: { provider: string; model: string } }>("session.models", payload),
  selectModel: (payload: { sessionId: string; provider: string; model: string; reasoningEffort?: string }) =>
    unary("session.selectModel", payload),
  llmModels: () => unary<{ groups: Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }> }>("llm.models", {}),
  /** Unified model options for selectors: the engine catalog first; rc.2-era
   *  llm/models as fallback. session.modelCatalog does not exist on the
   *  pinned engine (404 → fallback is the designed path, not an error). */
  modelOptions: async () => {
    const flatten = (groups: Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }>) => {
      const options: Array<{ provider: string; model: string; label: string; providerLabel: string }> = [];
      for (const g of groups ?? []) {
        for (const m of g.models ?? []) {
          options.push({ provider: g.id, model: m.id, label: m.name ?? m.id, providerLabel: g.name ?? g.id });
        }
      }
      return options;
    };
    try {
      const cat = await api.sessionModelCatalog();
      const options = flatten(cat.groups ?? []);
      return { options, default: cat.default };
    } catch { /* route absent on this engine */ }
    const r = await api.llmModels();
    return { options: flatten(r.groups ?? []) };
  },
  sessionRename: (payload: { sessionId: string; title: string }) =>
    unary("session.rename", { sessionId: payload.sessionId, title: payload.title }),
  workspaceArchiveSession: (payload: { sessionId: string }) =>
    unary("workspace.archiveSession", { sessionId: payload.sessionId }),
  sessionModelCatalog: () => unary<{
    default: { provider: string; model: string };
    routableProviders?: string[];
    groups: Array<{ id: string; name: string; models: Array<{ id: string; name: string; description?: string }> }>;
  }>("session.modelCatalog", {}),
  settingsDescribe: () => unary<SettingsDescribe>("settings.describe", {}),
  settingsUpdate: (payload: { ns: string; patch: unknown; expectedRevision: unknown }) => unary("settings.update", payload),
  settingsMutate: (payload: { ns: string; ops: Array<{ op: string; path: string; value?: unknown }>; expectedRevision: unknown }) =>
    unary("settings.mutate", payload),
  credentialsDescribe: (payload: { refs: string[] }) =>
    unary<{ credentials: Record<string, { configured: boolean; source?: string; writable?: boolean }> }>("credentials.describe", payload),
  credentialsSet: (payload: { ref: string; value: string }) => unary("credentials.set", payload),
  credentialsUnset: (payload: { ref: string }) => unary("credentials.unset", payload),
  openMux: (onFrame: (frame: MuxFrame) => void, onOpen: () => void) => openMux(onFrame, onOpen),
  /** Escape hatch for the settings panes: same dot-form + flat payload rules. */
  callRaw: <T = unknown>(method: string, payload: unknown) => unary<T>(method, payload),
};

export interface SettingsNamespaceEntry {
  ns: string;
  schema?: unknown;
  value: unknown;
  base?: unknown;
  user?: unknown;
  applies?: unknown;
  revision: unknown;
  secrets?: Array<{ path: string; set: boolean }>;
  writable?: boolean;
}

export interface SettingsDescribe {
  writable?: boolean;
  hasDocument?: boolean;
  namespaces: SettingsNamespaceEntry[];
}

/** Capability probe (SPEC-SETTINGS §4.2): empty-payload call; 404 or a
 *  gateway-unavailable error code means the method is absent this engine.
 *  Any other outcome (success or argument error) means it exists. */
export async function probeMethod(method: string): Promise<boolean> {
  try {
    await unary(method, {});
    return true;
  } catch (err) {
    const msg = String((err as Error)?.message ?? "");
    if (msg.includes("HTTP 404")) return false;
    if (msg.startsWith("gateway/invocation-unavailable") || msg.startsWith("gateway/definition-unavailable")) return false;
    if (msg.startsWith("no such route") || msg.includes("unknown endpoint") || msg.includes("has no remote")) return false;
    return true; // method exists; the empty payload was just invalid
  }
}

/** Broadcast event downlink: every session's events + approval frames, one
 *  frame per WS message, `server-request`-wrapped (`payload` holds the
 *  logical frame). Engine-verified: reconnects every 2s while down. */
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
