import { mux, type RemoteEventWaterfallFrame } from "./mux";
import { normalizeSessionEvent, readWireVersionHeader } from "./wire/normalize";
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

/** 引擎业务错误的附加事实（挂在抛出的 Error 上）：code 是 wire 错误码，reason 是
 *  `details.reason`（附件准入那一类用它区分图片/文件与具体原因），engineMessage
 *  是引擎原文——展示用，避免去解析 `code: message` 这个拼接串。 */
export interface RpcErrorFacts {
  code?: string;
  reason?: string;
  engineMessage?: string;
}

/** wire 错误 → Error（附上 code/reason/engineMessage；无 details 时只带 code）。 */
function rpcError(error: { code?: string; message?: string; details?: unknown } | undefined): Error {
  const err = new Error(`${error?.code ?? "rpc"}: ${error?.message ?? "unknown"}`);
  Object.assign(err, {
    code: error?.code,
    reason: (error?.details as { reason?: string } | undefined)?.reason,
    engineMessage: error?.message,
  } satisfies RpcErrorFacts);
  return err;
}

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
  readWireVersionHeader(res); // wire 版本协商（docs/WIRE-V1.md §1）
  const full: { rpcId: string; result: RpcResult<T> } = await res.json();
  if (!full.result.ok) {
    throw rpcError(full.result.error);
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

// ── IM 渠道面（@xmanrui/dsh-im 插件的 HTTP 面）：每个渠道一个路由
// `POST /api/dsh-im/<渠道>`，信封与引擎 unary 同形，但 payload 里再嵌一层
// 「端点 + 参数」：{type:"client-request", rpcId, method:"dsh-im/<渠道>",
// payload:{method:<端点>, payload:<参数>}}。这是插件自己的契约（不是 typert
// 网关路由），形状取自其 host bundle 的注册函数（path:`/api/dsh-im${channel}`）。
// 插件缺席/未铺盘时整条路由 404 —— 调用方据此把整个 Bot Channel 降级掉。

export interface ImBot {
  botId: string;
  state: "connected" | "connecting" | "offline" | "error";
  connected: boolean;
  /** 凭据是否已保存（扫码配对成功后为真）。 */
  configured: boolean;
  /** 这个机器人默认跑在哪个工作区（绝对路径；空串 = 未设置）。 */
  workspace: string;
  /** 这个机器人用的模型（null = 跟随引擎默认）。 */
  model: { provider: string; model: string; reasoningEffort?: string } | null;
  /** Agent 预设 id（空串 = 未设置）。 */
  agentPreset: string;
  /** 访问策略（谁能用这个机器人）。读不到完整策略时为 null——UI 据此不渲染编辑器。 */
  accessPolicy: ImAccessPolicy | null;
  bot: { name: string; accountIdMasked: string };
  health: { status: string; summary: string };
}

/** 机器人可选项：模型（提供方 + 模型，取插件快照的 modelCatalog）与预设。 */
export interface ImModelOption {
  provider: string;
  model: string;
  label: string;
}

/** 访问策略里的一个用户（白名单用户 / 开放模式的命令权限例外，两者同形状）。 */
export interface ImAccessUser {
  id: string;
  canExecuteCommands: boolean;
}

/** 一种会话类型的访问设置。**形状与 wire 完全一致**（不另立扁平表示）——
 *  插件侧 validateAccessPolicy 要求精确键（mode/open/allowlist，open 下两个键、
 *  allowlist 下 users），且保存时整份发回，照搬最不容易错。 */
export interface ImAccessScope {
  mode: "open" | "allowlist";
  open: {
    defaultCanExecuteCommands: boolean;
    commandPermissionOverrides: ImAccessUser[];
  };
  allowlist: { users: ImAccessUser[] };
}

/** 机器人访问策略：私聊 + 群聊**一次整份保存**（插件要求两边齐全）。 */
export interface ImAccessPolicy {
  direct: ImAccessScope;
  group: ImAccessScope;
}

export interface ImSnapshot {
  state: string;
  bots: ImBot[];
  totals: { configured: number; connected: number };
  /** 插件快照自带的目录；插件没给就是空表，UI 相应退化（不猜）。 */
  models: ImModelOption[];
  presets: Array<{ id: string; label: string }>;
}

/** 扫码配对的一次尝试：verificationUrl 就是二维码内容（前端交给壳画码）。 */
export interface ImProvision {
  attemptId: string;
  status: "starting" | "pending" | "scanned" | "needs_verification" | "connecting" | "connected" | "expired" | "failed" | "cancelled";
  verificationUrl: string;
  expiresAt: number;
  pollIntervalMs: number;
}

async function imCall<T>(channel: string, endpoint: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`/api/dsh-im/${channel}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "client-request",
      rpcId: uuid(),
      method: `dsh-im/${channel}`,
      payload: { method: endpoint, payload: args },
    }),
  });
  if (!res.ok) throw new Error(`transport: dsh-im/${channel} HTTP ${res.status}`);
  const full: { result: RpcResult<T> } = await res.json();
  if (!full.result.ok) {
    throw new Error(`${full.result.error?.code ?? "rpc"}: ${full.result.error?.message ?? "unknown"}`);
  }
  return full.result.value as T;
}

/** 渠道快照的边界收窄（铁律 5）：wire 载荷按 unknown 处理，逐字段判定后落成
 *  契约形状——字段漂移一律按缺省落，不让 undefined 进 UI。 */
function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function narrowAccessUsers(v: unknown): ImAccessUser[] | null {
  if (!Array.isArray(v)) return null;
  const users: ImAccessUser[] = [];
  for (const item of v) {
    const u = asRecord(item);
    const id = asString(u?.id);
    if (!u || !id || typeof u.canExecuteCommands !== "boolean") return null;
    users.push({ id, canExecuteCommands: u.canExecuteCommands });
  }
  return users;
}

function narrowAccessScope(v: unknown): ImAccessScope | null {
  const s = asRecord(v);
  const open = asRecord(s?.open);
  const mode = asString(s?.mode);
  if (mode !== "open" && mode !== "allowlist") return null;
  if (typeof open?.defaultCanExecuteCommands !== "boolean") return null;
  const overrides = narrowAccessUsers(open.commandPermissionOverrides);
  const users = narrowAccessUsers(asRecord(s?.allowlist)?.users);
  if (!overrides || !users) return null;
  return {
    mode,
    open: { defaultCanExecuteCommands: open.defaultCanExecuteCommands, commandPermissionOverrides: overrides },
    allowlist: { users },
  };
}

/** 读不到完整策略就当没有：拿不准当前状态时摆一套默认值等于说谎，
 *  UI 据此整块不渲染。 */
function narrowAccessPolicy(v: unknown): ImAccessPolicy | null {
  const p = asRecord(v);
  const direct = narrowAccessScope(p?.direct);
  const group = narrowAccessScope(p?.group);
  return direct && group ? { direct, group } : null;
}

export function narrowImSnapshot(payload: unknown): ImSnapshot {
  const raw = asRecord(payload) ?? {};

  const bots: ImBot[] = [];
  for (const item of Array.isArray(raw.bots) ? raw.bots : []) {
    const b = asRecord(item);
    const botId = asString(b?.botId);
    if (!b || !botId) continue;
    const m = asRecord(b.model);
    const provider = asString(m?.provider);
    const model = asString(m?.model);
    bots.push({
      botId,
      state: (asString(b.state, "error") as ImBot["state"]),
      connected: b.connected === true,
      configured: b.configured === true,
      workspace: asString(b.workspace),
      model: provider && model ? { provider, model } : null,
      agentPreset: asString(b.agentPreset),
      accessPolicy: narrowAccessPolicy(b.accessPolicy),
      bot: { name: asString(asRecord(b.bot)?.name, botId), accountIdMasked: asString(asRecord(b.bot)?.accountIdMasked) },
      health: { status: asString(asRecord(b.health)?.status), summary: asString(asRecord(b.health)?.summary) },
    });
  }

  // 目录：模型目录按「提供方分组 → 模型」摊平（组 id 即提供方 id）；预设取 items。
  const models: ImModelOption[] = [];
  const groups = asRecord(raw.modelCatalog)?.groups;
  for (const item of Array.isArray(groups) ? groups : []) {
    const group = asRecord(item);
    const provider = asString(group?.id);
    if (!provider) continue;
    for (const m of Array.isArray(group?.models) ? group!.models as unknown[] : []) {
      const entry = asRecord(m);
      const id = asString(entry?.id);
      if (!id) continue;
      models.push({ provider, model: id, label: asString(entry?.name, id) });
    }
  }
  const presets: Array<{ id: string; label: string }> = [];
  const presetItems = asRecord(raw.agentPresetCatalog)?.items;
  for (const item of Array.isArray(presetItems) ? presetItems : []) {
    const p = asRecord(item);
    const id = asString(p?.id);
    if (!id) continue;
    presets.push({ id, label: asString(p?.label, id) });
  }

  const totals = asRecord(raw.totals);
  return {
    state: asString(raw.state, "unknown"),
    bots,
    totals: {
      configured: typeof totals?.configured === "number" ? totals.configured : bots.length,
      connected: typeof totals?.connected === "number" ? totals.connected : bots.filter((b) => b.connected).length,
    },
    models,
    presets,
  };
}

export const im = {
  status: (channel: string) => imCall<unknown>(channel, "connection.status").then(narrowImSnapshot),
  begin: (channel: string, locale: string) => imCall<ImProvision>(channel, "provision.begin", { locale }),
  poll: (channel: string, attemptId: string) => imCall<ImProvision>(channel, "provision.poll", { attemptId }),
  cancel: (channel: string, attemptId: string) => imCall<unknown>(channel, "provision.cancel", { attemptId }),
  /** 端口径与插件的确认式删除一致：`{botId, confirm:true}`，回新快照。 */
  removeBot: (channel: string, botId: string) =>
    imCall<unknown>(channel, "bot.delete", { botId, confirm: true }).then(narrowImSnapshot),
  // ── 机器人细项（四端点参数名取自插件客户端源码的 saveBotSetting：
  //    统一 `{botId, …载荷}`，全部回新快照）──
  setBotAlias: (channel: string, botId: string, alias: string) =>
    imCall<unknown>(channel, "bot.alias.set", { botId, alias }).then(narrowImSnapshot),
  setBotWorkspace: (channel: string, botId: string, workspace: string) =>
    imCall<unknown>(channel, "bot.workspace.set", { botId, workspace }).then(narrowImSnapshot),
  setBotModel: (channel: string, botId: string, model: { provider: string; model: string }) =>
    imCall<unknown>(channel, "bot.model.set", { botId, model }).then(narrowImSnapshot),
  setBotPreset: (channel: string, botId: string, agentPreset: string) =>
    imCall<unknown>(channel, "bot.preset.set", { botId, agentPreset }).then(narrowImSnapshot),
  /** 访问策略整份发回：`{botId, policy}`——插件要求 direct/group 齐全且键精确
   *  （见 shared/access-policy.mjs 的 validateAccessPolicy）。 */
  setBotAccessPolicy: (channel: string, botId: string, policy: ImAccessPolicy) =>
    imCall<unknown>(channel, "bot.access-policy.set", { botId, policy }).then(narrowImSnapshot),
};

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

/** wire 记录 → HistoryEntry：记录全事件化（chunk 打包行随 V2→V3 迁移在引擎侧
 *  聚合成 settlement，客户端不再见到 'chunks' 记录），归一化过 wire v1。 */
function expandRecords(records: HistoryRecord[]): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const r of records) {
    if (r.type === "event") out.push({ event: normalizeSessionEvent(r.event) });
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
  /** IM 渠道面（Bot Channel / 机器人管理）——插件自己的路由，不是引擎 unary。 */
  im,
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
      handlers.onEvent(normalizeSessionEvent(frame.event));
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
  /** 插件清单（`pluginInventory/list`，只读投影）：Loader 的非 group entry。
   *  响应里另带 `agentPresets`（每个 Agent 预设的组合行），客户端不使用。 */
  pluginInventory: () => unary<{ entries: PluginInventoryEntry[] }>("pluginInventory/list", {}),
  /** 插件启停的落账（`pluginInventory/patchList`）：托管块里被用户显式设置过的行。
   *  「用户关掉的」与「本层本来就没挂载」在 inventory 里都是 enabled:false，靠这份
   *  落账才分得开（混在一起会让开关看着"点了没反应"，PITFALLS §7.6）。 */
  pluginPatchList: () => unary<{ toggles: PluginPatchToggle[] }>("pluginInventory/patchList", {}),
  /** MCP server 表（`pluginInventory/mcpList`）：行 + 每个 server 已配置的密钥 **名**。
   *  配置源与 0600 密钥文件都在引擎里（`mcp-admin.ts`），密钥值从不回前端。 */
  mcpList: () => unary<{ servers: McpServerRow[]; configured: Record<string, string[]> }>("pluginInventory/mcpList", {}),
  /** 全量保存 MCP 表（增删改都走它）。`secrets` 只带用户这次填了值的密钥，
   *  引擎与已存值合并；名字/必填项不过回 `mcp/invalid`。 */
  mcpSave: (servers: McpServerRow[], secrets: Record<string, Record<string, string>>) =>
    unary<{ ok: true }>("pluginInventory/mcpSave", { request: { servers, secrets } }),
  /** 拨一行；落盘成功即返回（引擎 `patchReload: live` 另行热重载，调用方等一拍再刷新清单）。
   *  `disabled: false` 也会显式落账：bundle 默认关的行只能靠这条覆盖重新打开。 */
  pluginPatchSet: (rowId: string, disabled: boolean) =>
    unary<{ ok: true }>("pluginInventory/patchSet", { request: { rowId, disabled } }),
  /** 技能管理面（设置 → 插件 → 技能）：技能根 `<DSH_HOME>/skills` 是引擎的状态，
   *  清单/新建/删除/安装都由引擎读写（`skills/admin*`），写完引擎自带的
   *  chokidar 发现立刻生效，不用重启。失败给稳定错误码，见 `skillsAdminError`。 */
  skillsAdmin: {
    list: () => unary<{ skills: SkillAdminEntry[] }>("skills/adminList", {}),
    create: (name: string, description: string) =>
      unary<{ ok: true }>("skills/adminCreate", { request: { name, description } }),
    remove: (id: string) => unary<{ ok: true }>("skills/adminRemove", { request: { id } }),
    /** 从目录安装：目录由壳的选目录 sheet 挑（`skillPickDirectory`）。 */
    install: (sourceDirectory: string) =>
      unary<{ ok: true }>("skills/adminInstall", { request: { sourceDirectory } }),
  },
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
    attachments?: import("./types").CommandSubmitAttachment[];
  }) =>
    unary<import("./types").CommandExecution | undefined>("commands/execute", {
      agentId: payload.agentId,
      line: payload.line,
      submittedAttachments: payload.attachments ?? [],
    }),
  /** 通用文件上传（0.1.5 流式路由）：POST /api/session/uploadFileBinary
   *  （octet-stream 直传字节，引擎逐块落盘；经桥自动带鉴权；桥整段缓冲
   *  转发，单请求上限 32MB——见 MiniHTTPServer.maxBodyBytes，超出 413）。
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
        // 该路由回裸 JSON（FileUploadHttpResult = {ok,value} | {ok,error}），
        // 不是 unary 的 {result:{...}} 信封——按信封解曾让所有上传恒判失败。
        const body = xhr.response as { ok?: boolean; value?: { receiptId: string; file: { attachmentId: string; name: string; bytes: number } }; error?: { code: string; message: string } };
        if (xhr.status === 200 && body?.ok === true && body.value) resolve(body.value);
        else reject(new Error(body?.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error("upload network error"));
      payload.signal?.addEventListener("abort", () => { xhr.abort(); reject(new DOMException("upload aborted", "AbortError")); });
      xhr.send(payload.file);
    }),
  /** 会话模型选择（模型 + 可选档位是一份 durable 选择）；返回值是引擎归一后的
   *  选择——省略档位时 resolveCallConfig 会解析成该模型的适配器默认档，可能物化
   *  成一个具体 id，所以档位显示取 `selected`，不本地猜「没传就是 Default」。 */
  selectModel: (payload: { sessionId: string; provider: string; model: string; reasoningEffort?: string }) =>
    unary<{ selected: { provider: string; model: string; reasoningEffort?: string } }>("session/selectModel", { request: payload }),
  sessionModelCatalog: () => unary<{
    default: { provider: string; model: string };
    routableProviders?: string[];
    groups: Array<{ id: string; name: string; models: Array<{ id: string; name: string; description?: string; inputModalities?: string[]; contextWindow?: number; cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number }; reasoning?: { efforts: Array<{ id: string; name: string }>; defaultEffort?: string } }> }>;
    failures?: Array<{ id: string; name: string; message: string }>;
  }>("session/modelCatalog", {}),
  /** 统一模型选项（选择器数据源）：session/modelCatalog 是唯一目录面
   *  （session/models 与 llm/models 已随 0.1.2 移除）。reasoning 元数据必须
   *  透传——模型菜单靠它决定「选完即关」还是「进档位选择页」；能力事实
   *  （inputModalities/contextWindow）是详情卡的引擎侧事实。 */
  modelOptions: async () => {
    type CatalogGroup = { id: string; name: string; models: Array<{ id: string; name: string; inputModalities?: string[]; contextWindow?: number; cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number }; reasoning?: { efforts?: Array<{ id: string; name: string }>; defaultEffort?: string } }> };
    const flatten = (groups: CatalogGroup[]) => {
      const options: Array<{ provider: string; model: string; label: string; providerLabel: string; efforts?: Array<{ id: string; name: string }>; defaultEffort?: string; inputModalities?: string[]; contextWindow?: number; cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number } }> = [];
      for (const g of groups ?? []) {
        for (const m of g.models ?? []) {
          const efforts = m.reasoning?.efforts?.length ? m.reasoning.efforts : undefined;
          options.push({
            provider: g.id, model: m.id, label: m.name ?? m.id, providerLabel: g.name ?? g.id,
            ...(efforts ? { efforts, ...(m.reasoning?.defaultEffort ? { defaultEffort: m.reasoning.defaultEffort } : {}) } : {}),
            ...(m.inputModalities?.length ? { inputModalities: m.inputModalities } : {}),
            ...(m.contextWindow === undefined ? {} : { contextWindow: m.contextWindow }),
            ...(m.cost === undefined ? {} : { cost: m.cost }),
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
  /** 取消归档（`workspace/unarchiveSessions`，幂等）：归档集在引擎里，调用后即生效。 */
  workspaceUnarchiveSessions: (sessionIds: string[]) =>
    unary<{ archivedSessionIds: string[] }>("workspace/unarchiveSessions", { request: { sessionIds } }),
  /** 删除会话（`session/deleteSessions`）：日志、投影缓存、归档集、工作区记账一起删。
   *  批次是部分的——`refused` 逐 id 给原因（busy 在跑/正开着、missing 没有日志、
   *  failed 存储拒绝），调用方据码说人话。 */
  sessionDeleteSessions: (sessionIds: string[]) =>
    unary<{ deleted: string[]; refused: Array<{ sessionId: string; reason: "busy" | "missing" | "failed"; detail?: string }> }>(
      "session/deleteSessions",
      { request: { sessionIds } },
    ),
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

/** pluginInventory/list 的一行：Loader 树里的一个非 group 插件条目。
 *  `enabled:false` 表示**本层没挂载它**（不是"用户关掉了"）；`fiberPhase` 是本进程里
 *  这一刻的 fiber 状态（null = 没有活着的根 fiber）。 */
export interface PluginInventoryEntry {
  entryId: string;
  moduleName: string;
  enabled: boolean;
  fiberPhase: PluginFiberPhase;
}

export type PluginFiberPhase = "pending" | "loading" | "active" | "failed" | "unloading" | null;

/** 一个 MCP server 行（`pluginInventory/mcpList`）：密钥的**值**不在其中。 */
export interface McpServerRow {
  /** 行 id（`mcp-<名字>`）：启停开关的 patch 目标。 */
  rowId: string;
  /** serverName；模型侧工具名是 `mcp__<名字>__<工具>`。 */
  name: string;
  /** 引擎的取值是 `streamable-http`，不是 `http`。 */
  transport: "stdio" | "streamable-http";
  command: string;
  args: string[];
  url: string;
  /** stdio：要注入的**环境变量名**（值在引擎的密钥表里，patch 只留引用）。 */
  env: string[];
  /** streamable-http：要注入的**请求头名**（值同上）。 */
  headers: string[];
  enabled: boolean;
}

/** 一行被用户显式设置过的插件开关（`pluginInventory/patchList` 的条目）。 */
export interface PluginPatchToggle {
  /** 目标是**组合行 id**（`hmr`），不是 inventory 的 entryId（`include:hmr`）。 */
  rowId: string;
  disabled: boolean;
}

/** skills/adminList 的一行：技能根下的一层技能目录。目录名 = 发现单位 = 删除目标；
 *  `missing` 非空表示 frontmatter 缺必填键，引擎会**静默忽略**这个技能（所以列表里
 *  照样显示，并标出缺了什么，不替它补默认值）。 */
export interface SkillAdminEntry {
  id: string;
  title: string;
  detail: string;
  /** SKILL.md 绝对路径（Finder 定位）。 */
  manifest: string;
  /** 技能目录绝对路径（确认框里展示）。 */
  directory: string;
  missing: string[];
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
