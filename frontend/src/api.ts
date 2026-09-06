import type { HistoryEntry, MuxFrame, PromptContentPart, QuestionAnswerItem, RpcResult, SessionSummary, WorkspaceView } from "./types";

// Same-origin bridge (/api → engine). Wire contract audited against the
// engine's own UNARY_ROUTES (see docs/PITFALLS.md §4.6 — do not guess); the
// pinned runtime is whatever scripts/dsh-runtime-version.txt says (rc.2
// at the time of writing — the alpha.2 detour and its differences are
// documented in PITFALLS §7.1):
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

/** Respond to a pending server-request (approval / question). The rpcId must
 *  be the one carried by the request's server-request envelope — the engine
 *  routes /api/respond strictly through its pending table, so a fresh random
 *  id is silently dropped as not-pending. */
async function respondTo(rpcId: string, value: unknown): Promise<{ accepted: boolean; reason?: string }> {
  const res = await fetch("/api/respond", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "client-response",
      rpcId,
      result: { ok: true, value },
    }),
  });
  if (!res.ok) throw new Error(`respond HTTP ${res.status}`);
  return res.json();
}

/** Reject a pending server-request (question cancel path: error.code=cancelled). */
async function respondCancel(rpcId: string): Promise<void> {
  const res = await fetch("/api/respond", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "client-response",
      rpcId,
      result: { ok: false, error: { code: "cancelled", message: "cancelled by user" } },
    }),
  });
  if (!res.ok) throw new Error(`respond HTTP ${res.status}`);
}

// ── 导入面板（dsh-chat-import 插件的 /api-import/* 面板路由；普通 JSON，
// 非 RPC 信封。插件由壳随包安装进 harness home web profile，见壳侧
// ChatImportPlugin；桥接对 /api-import/ 与 /api/ 同等中继）──

export interface ImportableSession {
  format: string;
  sessionId: string;
  title: string | null;
  project: string | null;
  createdAt: number | null;
  lastActiveAt: number | null;
  messageCount: number | null;
  sourcePath: string;
  importStatus: string;
}

async function importPanelPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` })) as Record<string, unknown>;
  if (!json.ok) throw new Error(String(json.error ?? `HTTP ${res.status}`));
  return json as T;
}

export interface ImportSyncStatus {
  ok: true;
  config: { inbound: { enabled: boolean }; outbound: { enabled: boolean }; watch: { enabled: boolean }; intervalMs: number };
  status: Record<string, unknown>;
}

export interface ImportRunResult {
  sourcePath: string;
  format: string;
  total: number;
  imported: number;
  alreadyImported: number;
  appended: number;
  skipped: number;
  failed: number;
  /** 整条 sourcePath 导入失败时插件返回 status:"failed" + error（无数值字段）。 */
  error?: string;
}

export const api = {
  /** 列出其他 Agent 可导入的会话（插件被动发现，带 mtime 书签缓存）。 */
  importSessions: (payload: { source?: string; query?: string; offset?: number; limit?: number } = {}) =>
    importPanelPost<{ ok: true; sessions: ImportableSession[]; total: number; offset: number; limit: number }>(
      "/api-import/sessions", payload),
  /** 同步开关/状态（面板路由；watch=已导入源 mtime 门控续写，inbound=外部→DSH 自动带回）。 */
  importSyncStatus: () =>
    fetch("/api-import/sync").then((r) => r.json() as Promise<Record<string, unknown>>).then((json) => {
      if (!json.ok) throw new Error(String(json.error ?? `HTTP ${json.status ?? ""}`));
      return json as unknown as ImportSyncStatus;
    }),
  importSyncSet: (on: boolean) =>
    importPanelPost<{ ok: true }>("/api-import/sync", {
      inbound: { enabled: on },
      watch: { enabled: on },
    }),
  /** 按来源整批导入（sourcePath 聚合；插件幂等，已导入的记账跳过）。 */
  importRun: (payload: { items: Array<{ source: string; sourcePath: string }> }) =>
    importPanelPost<{ ok: true; results: Array<Partial<ImportRunResult> & { status?: string }> }>(
      "/api-import/import", payload,
    ).then((d) => ({
      ...d,
      // 失败条目（status:"failed"）没有数值字段，归一化成 0 + error，调用方汇总不出 NaN。
      results: d.results.map((r) => ({
        sourcePath: r.sourcePath ?? "",
        format: r.format ?? "",
        total: r.total ?? 0,
        imported: r.imported ?? 0,
        alreadyImported: r.alreadyImported ?? 0,
        appended: r.appended ?? 0,
        skipped: r.skipped ?? 0,
        failed: r.failed ?? (r.status === "failed" ? 1 : 0),
        error: r.error,
      })),
    })),

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
  prompt: (payload: { sessionId: string; mode: "queue" | "steer"; content: PromptContentPart[] }) =>
    unary<{ accepted: true; command?: { kind: string; text?: string } }>("session.prompt", payload),
  /** 修改一条仍挂起的排队消息（引擎源码契约：edit 仅接受文本 content）。 */
  updateQueue: (payload: {
    sessionId: string;
    itemId: string;
    action: { kind: "edit"; content: Array<{ type: "text"; text: string }> } | { kind: "remove" } | { kind: "steer" };
  }) => unary<{ accepted: true }>("session.updateQueue", payload),
  cancel: (payload: { sessionId: string }) => unary("session.cancel", payload),
  /** 从轮收尾 seq 分叉出子会话（官方 forkAt 同款），返回子会话 id。 */
  fork: (payload: { sessionId: string; atSeq: number }) =>
    unary<{ sessionId: string }>("session.fork", payload),
  /** 全文搜索（标题∪正文，≤20 条 snippet≤240）。引擎侧默认禁用
   *  session-query 索引——壳以 --patch overlay 放行（DSH-WIRE §1）；
   *  未放行的部署上这里会 reject，调用方按 title-only 降级。 */
  search: (payload: { query: string }) =>
    unary<{ items: Array<{ sessionId: string; snippet: string }>; hasMore: boolean }>("session.search", payload),
  /** 取一条图片附件的字节（base64，渲染用户消息图片用）。 */
  attachment: (payload: { sessionId: string; attachmentId: string }) =>
    unary<{ attachment: { attachmentId: string; mediaType: string; name?: string }; data: string }>("session.attachment", payload),
  /** Goal 长任务（5.1）：全部走 CAS 修订围栏，ref.revision 必须是投影里的当前值。 */
  goalCreate: (payload: { sessionId: string; objective: string; maxGoalRounds?: number }) =>
    unary<{ ref: { id: string; revision: number } }>("goal.create", payload),
  goalEdit: (payload: { sessionId: string; ref: { id: string; revision: number }; objective?: string; maxGoalRounds?: number }) =>
    unary<{ ref: { id: string; revision: number } }>("goal.edit", payload),
  goalPause: (payload: { sessionId: string; ref: { id: string; revision: number } }) =>
    unary<{ ref: { id: string; revision: number } }>("goal.pause", payload),
  goalResume: (payload: { sessionId: string; ref: { id: string; revision: number } }) =>
    unary<{ ref: { id: string; revision: number } }>("goal.resume", payload),
  goalClear: (payload: { sessionId: string; ref: { id: string; revision: number } }) =>
    unary<{ ref: { id: string; revision: number } }>("goal.clear", payload),
  /** Subagent 谱系（5.2）：parentSessionId 的直接子会话目录。 */
  subagentList: (payload: { parentSessionId: string }) =>
    unary<{ entries: import("./types").SubagentListEntry[]; parentAvailable: boolean }>("subagent.list", payload),
  subagentInterrupt: (payload: { parentSessionId: string; childSessionId: string; mode: "continuable" }) =>
    unary<{ accepted: true }>("subagent.interrupt", payload),
  subagentHistory: (payload: { parentSessionId: string; childSessionId: string; mode: "one-shot" | "continuable"; beforeSeq?: number; maxMessages?: number }) =>
    unary<{ events: HistoryEntry[]; hasMore: boolean }>("subagent.history", payload),
  answerApproval: (value: { rpcId: string; sessionId: string; approvalId: string; outcome: "allowed-once" | "rejected" }) =>
    respondTo(value.rpcId, {
      sessionId: value.sessionId,
      approvalId: value.approvalId,
      outcome: value.outcome,
    }),
  /** Answer a pending ask_user_question request (outcome: answered). */
  answerQuestion: (value: { rpcId: string; sessionId: string; answers: QuestionAnswerItem[] }) =>
    respondTo(value.rpcId, {
      sessionId: value.sessionId,
      answer: { answers: value.answers },
    }),
  /** Cancel a pending ask_user_question request (outcome: cancelled → ASK_CANCELLED). */
  cancelQuestion: (rpcId: string) => respondCancel(rpcId),
  agentPresets: () => unary<{ presets: AgentPreset[] }>("agentPreset.list", {}),
  sessionModels: (payload: { sessionId: string }) =>
    unary<{
      current: { provider: string; model: string; reasoningEffort?: string };
      groups?: Array<{
        id: string;
        name: string;
        models: Array<{
          id: string;
          name: string;
          reasoning?: { efforts: Array<{ id: string; name: string }>; defaultEffort?: string };
        }>;
      }>;
    }>("session.models", payload),
  selectModel: (payload: { sessionId: string; provider: string; model: string; reasoningEffort?: string }) =>
    unary("session.selectModel", payload),
  llmModels: () => unary<{ groups: Array<{ id: string; name: string; models: Array<{ id: string; name: string; reasoning?: { efforts?: unknown[] } }> }> }>("llm.models", {}),
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
  // 能力探测闸（probeMethod）：引脚引擎无此路由，false 时归档页隐藏入口
  workspaceUnarchiveSession: (payload: { sessionId: string }) =>
    unary("workspace.unarchiveSession", { sessionId: payload.sessionId }),
  /** 注册一个已存在的目录为工作空间（官方 DSH「添加项目」同款路由）。
   *  已注册过则幂等返回 created:false。 */
  workspaceCreate: (payload: { path: string }) =>
    unary<{ workspace: WorkspaceView; created: boolean }>("workspace.create", payload),
  workspaceRename: (payload: { workspaceId: string; title: string }) =>
    unary<{ workspace: WorkspaceView }>("workspace.rename", payload),
  workspaceDelete: (payload: { workspaceId: string }) =>
    unary<{ deleted: true }>("workspace.delete", payload),
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
  llmProviders: () => unary<{ providers: Array<{ provider: string; displayName: string; settingsNs: string; settingsPath: string[]; active: boolean; declared?: boolean }> }>("llm.providers", {}),
  /** 探测端点可用模型（5.5 自定义提供方）：apiKey 只上送不存储。 */
  discoverModels: (payload: { settingsNs: string; provider?: string; baseURL?: string; api?: string; apiKey?: string }) =>
    unary<{ models: Array<{ id: string; name?: string; contextWindow?: number; maxTokens?: number }> }>("llm.discoverModels", payload),
  openMux: (onFrame: (frame: MuxFrame, rpcId?: string) => void, onOpen: () => void) => openMux(onFrame, onOpen),
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
  secrets?: Array<{ path: string[]; set: boolean }>;
  writable?: boolean;
}

export interface SettingsDescribe {
  writable?: boolean;
  hasDocument?: boolean;
  namespaces: SettingsNamespaceEntry[];
}

/** agentPreset.list 行。trust 只来自引擎目录归属（system=随引擎分发的内建
 *  预设 / user=用户自建），schema 见 vendored agent-presets。name 是引擎侧
 *  原样文本（内建预设为中文），展示层需自行本地化内建项（AgentMode）。 */
export interface AgentPreset {
  id: string;
  name: string;
  description?: string;
  trust?: "system" | "user";
  isDefault?: boolean;
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

/** Broadcast event downlink: every session's events + approval/question
 *  request frames, one frame per WS message. `server-request`-wrapped (the
 *  `payload` holds the logical frame; the envelope's rpcId is passed through
 *  because approvals and questions must answer with that exact id).
 *  Engine-verified: reconnects every 2s while down. */
function openMux(onFrame: (frame: MuxFrame, rpcId?: string) => void, onOpen: () => void): () => void {
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
        const rpcId = raw && typeof raw.rpcId === "string" ? raw.rpcId : undefined;
        onFrame(frame, rpcId);
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
