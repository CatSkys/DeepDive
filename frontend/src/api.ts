import { mux, type RemoteEventWaterfallFrame } from "./mux";
import type { HistoryEntry, PromptContentPart, QuestionAnswerItem, RpcResult, SessionAddress, SessionEvent, SessionSummary, WorkspaceView } from "./types";
import { uuid } from "./uuid";

// Same-origin bridge (/api → engine). Wire contract audited against the
// pinned engine source (vendored packages/api/gateway + packages/client/
// connection — do not guess); the pinned runtime is whatever
// scripts/dsh-runtime-version.txt says (0.1.2-rc.1 at the time of writing;
// the rc.2/alpha.2 history is in PITFALLS §4.6/§7.1):
//   POST /api/<namespace>/<method>  +  envelope { type:"client-request",
//   rpcId, method (must equal the endpoint string), payload: {args:{…named}} }
// Live data rides /api/remote.mux logical streams (mux.ts): $events forwarded
// events + session/follow / session/control / workspace/follow.

async function unary<T = unknown>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("/api/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "client-request",
      rpcId: uuid(),
      method,
      payload: { args },
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

/** follow/page 返回的 history 记录（wire 形状）：0.1.5/V3 只剩事件条目。 */
type HistoryRecord = { type: "event"; event: SessionEvent } | { type: string; [k: string]: unknown };

/** wire 记录 → HistoryEntry：0.1.5/V3 记录全事件化（chunk 打包行随 V2→V3
 *  迁移在引擎侧聚合成 settlement，客户端不再见到 'chunks' 记录），这里只
 *  做形状归一。 */
function expandRecords(records: HistoryRecord[]): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const r of records) {
    if (r.type === "event") out.push({ event: r.event as import("./types").SessionEvent });
  }
  return out;
}

/** session/follow 快照帧（types.ts SessionFollowFrame 的消费面）。 */
export interface FollowSnapshot {
  header: { id: string; parentSession?: string; origin?: "subagent" };
  cursor: number;
  entries: HistoryEntry[];
  hasMore: boolean;
  /** wire 形状 {asOfSeq, values}：投影真值都在 values 下（goal/turnOutline/…）。 */
  projections: { asOfSeq?: number; values?: Record<string, unknown> };
  /** 0.1.5 直播流重连基线（开流时活跃 attempt 的已累计 chunks）。 */
  assistantStream?: import("./types").AssistantStreamBaseline;
}

/** workspace/follow 帧（基线 + 增量，全量语义见 workspace-controller types）。 */
export type WorkspaceFollowFrame =
  | { type: "baseline"; value: { items: WorkspaceView[]; archivedSessionIds: string[] } }
  | { type: "upsert"; workspace: WorkspaceView }
  | { type: "remove"; workspaceId: string }
  | { type: "order"; workspaceIds: string[] }
  | { type: "archived"; archivedSessionIds: string[] };

/** session/control 帧（全 host 队列/后台任务/投影的实时面）。 */
export type ControlFrame =
  | { type: "baseline"; value: { queues: Record<string, import("./types").SessionQueuedItem[]>; jobs: Record<string, import("./types").JobView[]>; projections: Record<string, Record<string, unknown>> } }
  | { type: "queue"; sessionId: string; items: import("./types").SessionQueuedItem[] }
  | { type: "jobs"; sessionId: string; jobs: import("./types").JobView[] }
  | { type: "projection"; sessionId: string; key: string; value: unknown; seq: number };

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

  // list 的源码签名为 list(_request: SessionListRequest, signal)——保留参数
  // _request 在 wire 上必须显式出现（空对象）。
  sessions: () => unary<{ items: SessionSummary[] }>("session/list", { _request: {} }),
  createSession: (payload: { workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string }) =>
    unary<{ sessionId: string; agentPreset?: string }>("session/create", { request: payload }),
  /** 深历史向前翻页：throughSeq 必须取自对应 follow 开窗帧的 cursor。
   *  wire 形状（生成客户端实测）：单层 request 包裹。 */
  page: (payload: { address: SessionAddress; throughSeq: number; beforeSeq?: number; maxMessages?: number }) =>
    unary<{ records: HistoryRecord[]; hasMore: boolean }>("session/page", { request: payload })
      .then((p) => ({ entries: expandRecords(p.records), hasMore: p.hasMore })),
  /** 打开一条会话日志直播流：开窗快照 + 此后追加事件 + 0.1.5 直播流帧
   *  （assistantStream:true 是引擎开关；重连重发快照与流基线）。 */
  followSession: (
    address: SessionAddress,
    handlers: {
      onSnapshot: (s: FollowSnapshot) => void;
      onEvent: (ev: SessionEvent) => void;
      onStream?: (frame: import("./types").AssistantStreamFrame) => void;
    },
    maxMessages = 120,
  ) => mux.openStream("session/follow", { request: { address, maxMessages, assistantStream: true } }, (value) => {
    if (typeof value !== "object" || value === null) return;
    const frame = value as { type: string; [k: string]: unknown };
    if (frame.type === "snapshot") {
      handlers.onSnapshot({
        header: frame.header as FollowSnapshot["header"],
        cursor: frame.cursor as number,
        entries: expandRecords(frame.records as HistoryRecord[]),
        hasMore: frame.hasMore as boolean,
        projections: frame.projections as FollowSnapshot["projections"],
        assistantStream: frame.assistantStream as FollowSnapshot["assistantStream"],
      });
    } else if (frame.type === "assistant-stream") {
      handlers.onStream?.(frame.frame as import("./types").AssistantStreamFrame);
    } else if (frame.type === "event") {
      // SessionFollowFrame 的 live 分支就是 SessionEventEntry 本体
      // （engine packages/api/session-controller/src/types.ts）：
      // {type:'event', event: SessionEvent}。多剥一层会得到 undefined，
      // onEvent 抛错被 mux 吞掉 → 直播正文永空白而快照正常。
      handlers.onEvent(frame.event as SessionEvent);
    }
  }),
  prompt: (payload: { requestId: string; sessionId: string; mode: "queue" | "steer"; content: PromptContentPart[] }) =>
    unary<{ accepted: true }>("session/prompt", { request: payload }),
  /** 修改一条仍挂起的排队消息（引擎源码契约：edit 仅接受文本 content）。 */
  updateQueue: (payload: {
    sessionId: string;
    itemId: string;
    action: { kind: "edit"; content: Array<{ type: "text"; text: string }> } | { kind: "remove" } | { kind: "steer" };
  }) => unary<{ accepted: true }>("session/updateQueue", { request: payload }),
  cancel: (payload: { sessionId: string }) => unary("session/cancel", { request: payload }),
  /** 从轮收尾 seq 分叉出子会话（官方 forkAt 同款），返回子会话 id。 */
  fork: (payload: { sessionId: string; atSeq: number }) =>
    unary<{ sessionId: string }>("session/fork", { request: payload }),
  /** 全文搜索（标题∪正文，≤20 条 snippet≤240）；session-query 自 0.1.2 起
   *  随 base bundle 常开，不再依赖 --patch overlay。 */
  search: (payload: { query: string }) =>
    unary<{ items: Array<{ sessionId: string; snippet: string }>; hasMore: boolean }>("session/search", { request: payload }),
  /** 取一条图片附件的字节（base64，渲染用户消息图片用）。 */
  attachment: (payload: { sessionId: string; attachmentId: string }) =>
    unary<{ attachment: { attachmentId: string; mediaType: string; name?: string }; data: string }>("session/attachment", { request: payload }),
  /** Goal 长任务（5.1）：全部走 CAS 修订围栏；作用域首参 agentId=会话 id。 */
  goalCreate: (payload: { sessionId: string; objective: string; maxGoalRounds?: number }) =>
    unary<{ ref: { id: string; revision: number } }>("goals/create", {
      agentId: payload.sessionId,
      request: { objective: payload.objective, ...(payload.maxGoalRounds === undefined ? {} : { maxGoalRounds: payload.maxGoalRounds }) },
    }),
  goalEdit: (payload: { sessionId: string; ref: { id: string; revision: number }; objective?: string; maxGoalRounds?: number }) =>
    unary("goals/edit", {
      agentId: payload.sessionId,
      ref: payload.ref,
      request: {
        ...(payload.objective === undefined ? {} : { objective: payload.objective }),
        ...(payload.maxGoalRounds === undefined ? {} : { maxGoalRounds: payload.maxGoalRounds }),
      },
    }),
  goalPause: (payload: { sessionId: string; ref: { id: string; revision: number } }) =>
    unary("goals/pause", { agentId: payload.sessionId, ref: payload.ref }),
  goalResume: (payload: { sessionId: string; ref: { id: string; revision: number } }) =>
    unary("goals/resume", { agentId: payload.sessionId, ref: payload.ref }),
  goalClear: (payload: { sessionId: string; ref: { id: string; revision: number } }) =>
    unary("goals/clear", { agentId: payload.sessionId, ref: payload.ref }),
  /** Subagent 谱系（5.2）：parentSessionId 的直接子会话目录。 */
  subagentList: (payload: { parentSessionId: string }) =>
    unary<{ entries: import("./types").SubagentListEntry[]; parentAvailable: boolean }>("subagents/list", payload),
  subagentInterrupt: (payload: { parentSessionId: string; childSessionId: string }) =>
    unary("subagents/interruptByParent", { parentSessionId: payload.parentSessionId, childSessionId: payload.childSessionId, mode: "continuable" }),
  /** 审批应答：waterfall 交互请求按 eventId 经 $events/result 回值
   *  （'allowed-once' | 'rejected'，官方 ApprovalDecision 字面量）。 */
  answerApproval: (eventId: string, outcome: "allowed-once" | "rejected") =>
    mux.answerEvent(eventId, { kind: "result", value: outcome }),
  /** 提问应答（outcome: answered）；answers 按 id 配对所选选项。 */
  answerQuestion: (eventId: string, answers: QuestionAnswerItem[]) =>
    mux.answerEvent(eventId, { kind: "result", value: { answers } }),
  /** 取消挂起提问（rejected → 引擎侧按取消结算，ASK_CANCELLED 同义）。 */
  cancelQuestion: (eventId: string) =>
    mux.answerEvent(eventId, { kind: "rejected", error: { name: "Error", message: "cancelled by user", code: "cancelled" } }),
  agentPresets: () => unary<{ presets: AgentPreset[]; authorable?: boolean }>("agentPresets/list", {}),
  /** @ 文件候选（0.1.2 fileReferences/list，扁平 {agentId, query}）：cwd 亲和
   *  整库递归索引排序；含 / 的查询退化为该目录列举。路径相对 agent cwd。 */
  fileCandidates: (agentId: string, query: string) =>
    unary<Array<{ path: string; kind: "file" | "directory" }>>("fileReferences/list", { agentId, query }),
  /** @ 会话引用候选（0.1.2 sessionReferenceResolver/candidates）：cwd 亲和
   *  排序、自带引擎规范 mention（排除自身）。 */
  sessionCandidates: (agentId: string, query: string) =>
    unary<Array<{ sessionId: string; label: string; cwd?: string; sameWorkspace?: boolean; createdAt?: number; mention: string }>>(
      "sessionReferenceResolver/candidates", { agentId, query }),
  /** 引擎命令目录（0.1.2 commands/list，扁平 {agentId}；插件注册面随引擎走）。 */
  commandsList: (agentId: string) =>
    unary<import("./types").CommandDescriptor[]>("commands/list", { agentId }),
  /** 执行一条整行斜杠命令（0.1.5）：自驱效果，不经 session/prompt；回包
   *  undefined = 未知命令（引擎未落事件）。submittedAttachments 是引擎
   *  0.1.5 的 wire 键（0.1.2 叫 images，升引脚实测改名）：图片直传字节、
   *  通用文件走 receiptId。 */
  commandExecute: (payload: {
    agentId: string;
    line: string;
    attachments?: Array<
      | { type: "image"; mediaType: string; data: string; name?: string }
      | { type: "file"; receiptId: string }
    >;
  }) =>
    unary<import("./types").CommandExecution | undefined>("commands/execute", {
      agentId: payload.agentId,
      line: payload.line,
      submittedAttachments: payload.attachments ?? [],
    }),
  /** 通用文件上传（0.1.5 流式路由）：POST /api/session/uploadFileBinary
   *  （octet-stream 直传字节，引擎逐块落盘、无字节上限；经桥自动带鉴权）。
   *  onProgress 报已上传字节；abort() 取消。回执 receiptId 进 prompt 的
   *  {type:'file'} 部件，随 requestId 生命周期退役。 */
  uploadFileStreaming: (payload: {
    sessionId: string;
    file: Blob;
    name?: string;
    onProgress?: (loaded: number, total: number) => void;
    signal?: AbortSignal;
  }) =>
    new Promise<{ receiptId: string; file: { attachmentId: string; name: string; bytes: number } }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const params = new URLSearchParams({ sessionId: payload.sessionId });
      if (payload.name) params.set("name", payload.name);
      xhr.open("POST", `/api/session/uploadFileBinary?${params.toString()}`);
      xhr.setRequestHeader("content-type", "application/octet-stream");
      xhr.responseType = "json";
      xhr.upload.onprogress = (e) => payload.onProgress?.(e.loaded, e.total);
      xhr.onload = () => {
        const body = xhr.response as { result?: { ok: boolean; value?: { receiptId: string; file: { attachmentId: string; name: string; bytes: number } }; error?: { code: string; message: string } } };
        if (xhr.status === 200 && body?.result?.ok && body.result.value) resolve(body.result.value);
        else reject(new Error(body?.result?.error ? `${body.result.error.code}: ${body.result.error.message}` : `HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error("upload network error"));
      payload.signal?.addEventListener("abort", () => { xhr.abort(); reject(new DOMException("upload aborted", "AbortError")); });
      xhr.send(payload.file);
    }),
  /** 可继续子会话发消息（0.1.5 subagents/prompt）：content 只收文本/图片
   *  （子会话无文件通道）；delivery=queue|steer。 */
  subagentPrompt: (payload: {
    requestId: string; parentSessionId: string; childSessionId: string;
    delivery: "queue" | "steer"; content: PromptContentPart[];
  }) =>
    unary<{ messageId: string }>("subagents/prompt", {
      request: {
        requestId: payload.requestId, parentSessionId: payload.parentSessionId, childSessionId: payload.childSessionId,
        mode: "continuable", delivery: payload.delivery, content: payload.content,
      },
    }),
  selectModel: (payload: { sessionId: string; provider: string; model: string; reasoningEffort?: string }) =>
    unary("session/selectModel", { request: payload }),
  sessionModelCatalog: () => unary<{
    default: { provider: string; model: string };
    routableProviders?: string[];
    groups: Array<{ id: string; name: string; models: Array<{ id: string; name: string; description?: string; reasoning?: { efforts: Array<{ id: string; name: string }>; defaultEffort?: string } }> }>;
    failures?: Array<{ id: string; name: string; message: string }>;
  }>("session/modelCatalog", {}),
  /** 统一模型选项（选择器数据源）：session/modelCatalog 是唯一目录面
   *  （session/models 与 llm/models 已随 0.1.2 移除）。reasoning 元数据必须
   *  透传——模型菜单靠它决定「选完即关」还是「进档位滑杆页」。 */
  modelOptions: async () => {
    type CatalogGroup = { id: string; name: string; models: Array<{ id: string; name: string; reasoning?: { efforts?: Array<{ id: string; name: string }>; defaultEffort?: string } }> };
    const flatten = (groups: CatalogGroup[]) => {
      const options: Array<{ provider: string; model: string; label: string; providerLabel: string; efforts?: Array<{ id: string; name: string }>; defaultEffort?: string }> = [];
      for (const g of groups ?? []) {
        for (const m of g.models ?? []) {
          const efforts = m.reasoning?.efforts?.length ? m.reasoning.efforts : undefined;
          options.push({
            provider: g.id, model: m.id, label: m.name ?? m.id, providerLabel: g.name ?? g.id,
            ...(efforts ? { efforts, ...(m.reasoning?.defaultEffort ? { defaultEffort: m.reasoning.defaultEffort } : {}) } : {}),
          });
        }
      }
      return options;
    };
    const cat = await api.sessionModelCatalog();
    return { options: flatten(cat.groups ?? []), default: cat.default };
  },
  sessionRename: (payload: { sessionId: string; title: string }) =>
    unary("session/rename", { request: { sessionId: payload.sessionId, title: payload.title } }),
  workspaceArchiveSession: (payload: { sessionId: string }) =>
    unary("workspace/archiveSession", { request: { sessionId: payload.sessionId } }),
  /** 注册一个已存在的目录为工作空间（官方 DSH「添加项目」同款路由）。
   *  已注册过则幂等返回 created:false。 */
  workspaceCreate: (payload: { path: string }) =>
    unary<{ workspace: WorkspaceView; created: boolean }>("workspace/create", { request: payload }),
  workspaceRename: (payload: { workspaceId: string; title: string }) =>
    unary<{ workspace: WorkspaceView }>("workspace/rename", { request: payload }),
  workspaceDelete: (payload: { workspaceId: string }) =>
    unary<{ deleted: true }>("workspace/delete", { request: payload }),
  /** 工作区实时面（workspace.list 已随 0.1.2 改为 follow 流；基线+增量）。 */
  openWorkspaces: (onFrame: (frame: WorkspaceFollowFrame) => void) =>
    mux.openStream("workspace/follow", {}, (value) => {
      if (typeof value === "object" && value !== null) onFrame(value as WorkspaceFollowFrame);
    }),
  /** 全 host 实时控制面：队列/后台任务/投影（基线 + 逐会话增量）。 */
  openControl: (onFrame: (frame: ControlFrame) => void) =>
    mux.openStream("session/control", {}, (value) => {
      if (typeof value === "object" && value !== null) onFrame(value as ControlFrame);
    }),
  /** $events 转发事件订阅（审批/提问 waterfall + 会话生命周期 emit）。 */
  onEvents: (handlers: {
    onEmit?: (event: string, args: unknown[]) => void;
    onWaterfall?: (frame: RemoteEventWaterfallFrame) => void;
    onCancel?: (eventId: string) => void;
  }) => mux.onEvents(handlers),
  settingsDescribe: () => unary<SettingsDescribe>("settings/describe", {}),
  settingsUpdate: (payload: { ns: string; patch: unknown; expectedRevision: unknown }) => unary("settings/update", payload as unknown as Record<string, unknown>),
  settingsMutate: (payload: { ns: string; ops: Array<{ op: "set" | "unset"; path: string[]; value?: unknown }>; expectedRevision: unknown }) =>
    unary("settings/mutate", payload as unknown as Record<string, unknown>),
  /** 密钥实况。返回体是 ref → CredentialInfo 的裸 map（0.1.5 契约：生成客户端
   *  `dsh-api-settings-controller` 声明 `describe: refs => Record<string, CredentialInfo>`，
   *  0.1.2 的 `{credentials:{…}}` 包裹已不存在）。 */
  credentialsDescribe: (payload: { refs: string[] }) =>
    unary<Record<string, { configured: boolean; source?: string; writable?: boolean }>>("credentials/describe", payload),
  credentialsSet: (payload: { ref: string; value: string }) => unary("credentials/set", payload),
  credentialsUnset: (payload: { ref: string }) => unary("credentials/unset", payload),
  /** 可配置提供方目录（display 元数据在 llm/listProviders，配置归属在此）。 */
  llmProviders: () => unary<Array<{ provider: string; displayName: string; settingsNs: string; settingsPath: string[] }>>("llm/listConfigurableProviders", {}),
  /** 探测端点可用模型（5.5 自定义提供方）：apiKey 只上送不存储。 */
  discoverModels: (payload: { settingsNs: string; provider?: string; baseURL?: string; api?: string; apiKey?: string }) =>
    unary<Array<{ id: string; name?: string; contextWindow?: number; maxTokens?: number }>>("llm/discoverModels", {
      settingsNs: payload.settingsNs,
      request: { ...(payload.provider === undefined ? {} : { provider: payload.provider }),
        ...(payload.baseURL === undefined ? {} : { baseURL: payload.baseURL }),
        ...(payload.api === undefined ? {} : { api: payload.api }),
        ...(payload.apiKey === undefined ? {} : { apiKey: payload.apiKey }) },
    }),
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

/** agentPresets/list 行（trust 只来自引擎目录归属；name 为引擎侧原样文本，
 *  内建预设展示层自行本地化（AgentMode）。 */
export interface AgentPreset {
  id: string;
  name?: string;
  description?: string;
  trust?: "system" | "user";
  isDefault?: boolean;
  broken?: string;
}

/** Capability probe (SPEC-SETTINGS §4.2): empty-args call; 404 or a
 *  gateway-unavailable error code means the method is absent this engine.
 *  Any other outcome (success or an argument error) means it exists. */
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
