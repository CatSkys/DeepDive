import { uuid } from "./uuid";
// Shell↔frontend bridge mount (SPEC-NOTIFICATIONS-FLOATING-BALL §3.1).
//
// The native shell pushes instructions via WKWebView evaluateJavaScript on
// `window.__deepDiveHost.dispatch(cmd, payload)`; the frontend reports the
// mounted hook with a `host-ready` message on the "deepdiveHost" script
// message handler. The shell stages at most one pending command until this
// hook reports ready, so a notification tap during cold start is never lost.
// Degradation: in a plain browser (no webkit messageHandlers) everything
// here no-ops silently — the bridge is an enhancement, not a dependency.

interface HostBridge {
  dispatch: (cmd: string, payload?: unknown) => void;
}

declare global {
  interface Window {
    __deepDiveHost?: HostBridge;
    /** 两个通道：`deepdiveHost` = 指令（host.ts），`deepdive` = rect 表（titlebar/nativeSlot）。 */
    webkit?: {
      messageHandlers?: {
        deepdiveHost?: { postMessage: (msg: unknown) => void };
        deepdive?: { postMessage: (msg: unknown) => void };
      };
    };
  }
}

/** 是否跑在壳里（WKWebView 的 host 消息桥在）。
 *
 *  窗口 chrome——红绿灯 + 顶部 52px 标题栏条——**只有壳里有**：手机经局域网
 *  打开 SPA 时是普通浏览器，左上角没有红绿灯。所以"顶部两钮左偏移 84px"与
 *  "收起态给会话头让位的左内边距"都该按这个判据分支，而不是按窗口宽度猜
 *  （窄窗口的 Mac 窗口仍有红绿灯）。main.tsx 在首帧前把结果标到
 *  `<html data-shell>`，CSS 据此覆盖。 */
export function inShell(): boolean {
  return !!window.webkit?.messageHandlers?.deepdiveHost;
}

type HostEvent = (cmd: string, payload?: unknown) => void;
const listeners = new Set<HostEvent>();

export function onHostEvent(cb: HostEvent): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function sendToShell(message: Record<string, unknown>): void {
  window.webkit?.messageHandlers?.deepdiveHost?.postMessage(message);
}

/** 「rect 表」通道（`deepdive` message handler）：顶条控件 rect 与原生槽位 rect 共用，
 *  300ms 一推、量大且无应答——与 `deepdiveHost`（指令通道，壳侧走 case 表 + 单条暂存）
 *  分开是**壳侧按 channel 分派**的既有契约（MainWindowController.userContentController：
 *  `deepdive` → 两张 rect 表，`deepdiveHost` → 指令）。
 *  发错通道不会报错：壳那边只是"没人接"，表现为控件点不动/原生视图不显示。 */
export function sendRects(message: Record<string, unknown>): void {
  window.webkit?.messageHandlers?.deepdive?.postMessage(message);
}

/** 用默认应用打开一个本地路径（0.1.5 产物三动作之一；壳 NSWorkspace.open）。 */
export function openPath(path: string): void {
  sendToShell({ type: "open-path", path });
}

/** 在 Finder 中定位一个本地路径（壳 activateFileViewerSelecting）。 */
export function revealPath(path: string): void {
  sendToShell({ type: "reveal-path", path });
}

/** 用系统默认浏览器打开一个外部 URL（唯一入口：正文链接、侧栏浏览器的「在浏览器打开」）。
 *  只放行安全 scheme——javascript:/data: 一旦经壳 open-url 或新窗口打开即是执行面。 */
export function openExternalUrl(url: string): void {
  if (!/^(https?|file|mailto):/i.test(url)) return;
  if (inShell()) sendToShell({ type: "open-url", url });
  else window.open(url, "_blank");
}

/* ── 打开方式（全屏预览页右上选择器）：壳侧 OpenWithCatalog 列「能打开该
   文件的 App」+ 默认项 + 图标 dataURL；选一个就请壳用该 App 打开。 ── */

export interface OpenWithApp {
  /** .app 绝对路径（选它就把它交回壳）。 */
  id: string;
  name: string;
  /** `data:image/png;base64,…` */
  icon: string;
}

export interface OpenWithListing {
  apps: OpenWithApp[];
  /** 默认 App 的 id；壳给不出时是空串。 */
  defaultId: string;
}

/** 列候选 App；无壳桥 / 壳不回包 / 无候选都给空表（调用方据此隐藏入口）。 */
export function openWithList(path: string): Promise<OpenWithListing> {
  return bridgeRequest(
    "openWith",
    { apps: [], defaultId: "" },
    (p) => {
      const payload = p as { apps?: OpenWithApp[]; defaultId?: string } | undefined;
      return { apps: payload?.apps ?? [], defaultId: payload?.defaultId ?? "" };
    },
    (reqId) => sendToShell({ type: "open-with-list", reqId, path }),
  );
}

/** 用指定 App 打开（壳只认已存在的文件与 .app）。 */
export function openWith(path: string, app: string): void {
  sendToShell({ type: "open-path-with", path, app });
}

/* ── 会话维护（取消归档 / 删除）：引擎 wire 面没有这两个方法（官方亦然），
   而引擎把会话列表缓存在内存（实测：运行中删日志目录，session/list 照样列它）
   ——所以 UI 走本地覆盖集即时生效，壳只做两件事：① 立刻删掉被删会话的日志目录；
   ② 把覆盖集登记下来，在**下次启动的空窗期**（引擎还没起）落到引擎状态文件
   （SessionAdmin.applyPending）。全程不重启引擎。 ── */

export interface SessionAdminResult {
  removed: string[];
  error?: string;
}

/** 登记本地覆盖集（unarchived/removed）并同步删掉 removed 的日志目录；
 *  无壳桥时静默（纯浏览器）。壳在下次启动空窗期把引擎状态改到位。 */
/** 告诉壳哪些会话不该打扰用户（后台会话的"完成"不弹通知、不点亮悬浮球）。
 *  判据的唯一事实源在前端（session/backgroundSession），壳只照做。 */
export function setQuietSessions(ids: string[]): void {
  sendToShell({ type: "quiet-sessions", ids });
}

export function sessionAdminSync(payload: { unarchived: string[]; removed: string[] }): void {
  sendToShell({ type: "session-admin-sync", ...payload });
}

/** 删掉这些会话的日志目录（连同覆盖集一起同步）。只删目录、不重启引擎，
 *  所以是毫秒级；失败（目录被占/权限）时回包带 error。 */
export function sessionDeleteDirs(payload: { sessionIds: string[]; unarchived: string[]; removed: string[] }): Promise<SessionAdminResult> {
  return bridgeRequest(
    "sessionAdmin",
    { removed: [] },
    (p) => {
      const res = p as { removed?: string[]; error?: string } | undefined;
      return { removed: res?.removed ?? [], ...(res?.error ? { error: res.error } : {}) };
    },
    (reqId) => sendToShell({ type: "session-delete", reqId, ...payload }),
    20_000,
  );
}

/** 保持唤醒（自动化页的开关）：on = 按住空闲休眠断言，让到点的任务不至于
 *  因为 Mac 睡过去而错过。壳侧 KeepAwake 幂等；纯浏览器静默。 */
export function setKeepAwake(on: boolean): void {
  sendToShell({ type: "keep-awake", on });
}

/** 壳桥 req/resp 统一包装（AUD-049/090）：注册一次性监听 + 发送 + 超时降级
 *  ——壳不回包（桥挂/消息丢失）也按 fallback resolve，绝不永久 pending。
 *  match 收到本 reqId 的载荷时返回要 resolve 的值；纯浏览器环境直接降级。 */
function bridgeRequest<T>(
  cmdName: string,
  fallback: T,
  match: (payload: unknown) => T,
  send: (reqId: string) => void,
  timeoutMs = 10_000,
): Promise<T> {
  return new Promise((resolve) => {
    if (!window.webkit?.messageHandlers?.deepdiveHost) {
      resolve(fallback);
      return;
    }
    const reqId = uuid();
    let off: () => void = () => {};
    const timer = window.setTimeout(() => {
      off();
      resolve(fallback);
    }, timeoutMs);
    off = onHostEvent((cmd, payload) => {
      if (cmd !== cmdName) return;
      if ((payload as { reqId?: string } | undefined)?.reqId !== reqId) return;
      window.clearTimeout(timer);
      off();
      resolve(match(payload));
    });
    send(reqId);
  });
}

/** 壳侧目录列举（@ 引用候选源；引擎 browse 通道在桌面部署不可用，
 *  docs/DSH-WIRE.md §1）。纯浏览器环境 resolve 空数组。 */
export function listDir(path: string): Promise<Array<{ name: string; path: string; isDir: boolean }>> {
  return bridgeRequest(
    "dirListing",
    [],
    (p) => {
      const r = p as { entries?: Array<{ name: string; path: string; isDir: boolean }>; error?: string };
      return r.error ? [] : r.entries ?? [];
    },
    (reqId) => sendToShell({ type: "list-dir", reqId, path }),
  );
}

/** 壳侧工作区未提交改动摘要（run-git → gitStatus 回推）。引擎无 git 能力，
 *  这条链路只在桌面壳内可用；纯浏览器/非 git 仓库 resolve null。
 *  载荷在边界处收窄（铁律 5）：repo 必为真、files/additions/deletions 必为
 *  数值，缺一即 null——壳侧字段漂移不允许以 undefined 进入 UI 运算。 */
export function narrowGitStatus(p: unknown): import("./types").GitStatus | null {
  const v = p as Partial<import("./types").GitStatus> | null;
  if (!v || v.repo !== true) return null;
  if (typeof v.files !== "number" || typeof v.additions !== "number" || typeof v.deletions !== "number") return null;
  return { repo: true, branch: v.branch, files: v.files, additions: v.additions, deletions: v.deletions };
}

export function gitStatus(path: string): Promise<import("./types").GitStatus | null> {
  return bridgeRequest(
    "gitStatus",
    null,
    (p) => narrowGitStatus(p),
    (reqId) => sendToShell({ type: "run-git", reqId, path }),
  );
}

/** 壳侧执行一条 git 子命令（git-run → gitRunResult 回推；参数数组直传
 *  Process，不经 shell）。切分支/提交/推送等胶囊动作共用此通道。 */
export function gitRun(path: string, args: string[]): Promise<{ ok: boolean; output: string } | null> {
  return bridgeRequest(
    "gitRunResult",
    null,
    (p) => {
      const r = p as { ok?: boolean; output?: string };
      return { ok: !!r.ok, output: r.output ?? "" };
    },
    (reqId) => sendToShell({ type: "git-run", reqId, path, args }),
  );
}

/* ── 移动端远程访问（设置 → 移动端远程控制）：壳在局域网上再起一个监听，
   手机扫码配对后接管当前工作区。配对令牌与设备台账都在壳侧，前端只渲染
   快照；「复制链接」也交回壳写剪贴板（WKWebView 里的 clipboard 不可靠）。 ── */

export interface RemoteDevice {
  id: string;
  /** UA 归类：iphone / ipad / android / mac / web（展示文案归前端 i18n）。 */
  kind: string;
  pairedAt: number;
  lastSeen: number;
}

export interface RemoteStatus {
  on: boolean;
  port: number;
  /** 手机可达的本机地址；取不到为空串（此时链接与二维码都为空）。 */
  lanIp: string;
  url: string;
  /** `data:image/png;base64,…`。 */
  qr: string;
  devices: RemoteDevice[];
}

const REMOTE_OFF: RemoteStatus = { on: false, port: 0, lanIp: "", url: "", qr: "", devices: [] };

/** 壳侧快照的边界收窄（铁律 5）：字段漂移按缺省值落，不让 undefined 进 UI。 */
function narrowRemote(p: unknown): RemoteStatus {
  const v = p as Partial<RemoteStatus> | undefined;
  if (!v) return REMOTE_OFF;
  const devices: RemoteDevice[] = [];
  for (const item of Array.isArray(v.devices) ? v.devices : []) {
    const id = typeof item?.id === "string" ? item.id : "";
    if (!id) continue;
    devices.push({
      id,
      kind: typeof item?.kind === "string" ? item.kind : "web",
      pairedAt: typeof item?.pairedAt === "number" ? item.pairedAt : 0,
      lastSeen: typeof item?.lastSeen === "number" ? item.lastSeen : 0,
    });
  }
  return {
    on: v.on === true,
    port: typeof v.port === "number" ? v.port : 0,
    lanIp: typeof v.lanIp === "string" ? v.lanIp : "",
    url: typeof v.url === "string" ? v.url : "",
    qr: typeof v.qr === "string" && v.qr.startsWith("data:") ? v.qr : "",
    devices,
  };
}

/** 开关/刷新/解绑都回同一份快照，前端不自己拼状态。 */
function remoteCommand(type: string, extra: Record<string, unknown> = {}): Promise<RemoteStatus> {
  return bridgeRequest(
    "remoteStatus",
    REMOTE_OFF,
    narrowRemote,
    (reqId) => sendToShell({ type, reqId, ...extra }),
    20_000, // 首次开启要起监听并生成二维码
  );
}

export const remoteStatus = () => remoteCommand("remote-status");
export const remoteStart = () => remoteCommand("remote-start");
export const remoteStop = () => remoteCommand("remote-stop");
export const remoteRefresh = () => remoteCommand("remote-refresh");
export const remoteRevoke = (deviceId: string) => remoteCommand("remote-revoke", { deviceId });

/** 唯一剪贴板通道：写系统剪贴板只能壳做（WKWebView 里 navigator.clipboard
 *  要授权、语义也不同）。远程页复制链接与引擎失败详情复制诊断共用这一条。 */
export function copyText(text: string): void {
  sendToShell({ type: "copy-text", text });
}

/** 任意文本 → 二维码 data URL（Bot Channel 的扫码配对：插件给的是
 *  verificationUrl）。复用壳里那一份 CoreImage 生成器，前端不塞第二套 QR
 *  实现；无壳桥/壳不回包 resolve 空串（调用方按"画不出码"降级）。 */
/** 读其他 Agent 的模型配置**原文**（新手引导「迁移」步）：壳只搬运不解析，
 *  解析/映射在 onboarding/agentModelImport.ts。无壳桥/超时/无文件一律空表——
 *  调用方按"这家没有可导入的模型配置"降级，不做第二次尝试。 */
export function scanAgentConfigs(): Promise<Record<string, string>> {
  return bridgeRequest(
    "agentConfigs",
    {},
    (p) => {
      const files = (p as { files?: Record<string, string> } | undefined)?.files;
      if (!files || typeof files !== "object") return {};
      const out: Record<string, string> = {};
      for (const [source, text] of Object.entries(files)) {
        if (typeof text === "string") out[source] = text;
      }
      return out;
    },
    (reqId) => sendToShell({ type: "scan-agent-configs", reqId }),
    4000,
  );
}

export function qrEncode(text: string): Promise<string> {
  return bridgeRequest(
    "qrEncoded",
    "",
    (p) => {
      const qr = (p as { qr?: string } | undefined)?.qr;
      return typeof qr === "string" && qr.startsWith("data:") ? qr : "";
    },
    (reqId) => sendToShell({ type: "qr-encode", reqId, text }),
  );
}

/** 壳侧读项目根目录约定图标文件（icon.png / logo.* 等，见 WorkspaceIcon）
 *  为 dataURL；无图标/纯浏览器 resolve null（前端回落项目首字母）。
 *  壳每次都读盘——调用方按路径缓存，勿在渲染路径反复请求。 */
export function readWorkspaceIcon(path: string): Promise<string | null> {
  return bridgeRequest(
    "workspaceIcon",
    null,
    (p) => {
      const r = p as { dataUrl?: string };
      return typeof r.dataUrl === "string" && r.dataUrl.startsWith("data:") ? r.dataUrl : null;
    },
    (reqId) => sendToShell({ type: "read-workspace-icon", reqId, path }),
  );
}

/* ── 新建项目弹窗的落地准备：引擎 workspace/create 要求目录已存在（引擎侧
   realpath+stat 校验，vendored workspace 包），所以「留空自动建目录」只能在
   壳做——~/Documents/DeepDive Projects/<净化名>（撞名追加序号）；项目指令
   由壳写入 <目录>/AGENTS.md（已存在不改动）。纯浏览器 resolve 走 fallback
   （调用方按 hasShell 分流，本不该走到）。 ── */

export interface PreparedWorkspace {
  /** 落定后的目录绝对路径；失败为空串。 */
  path: string;
  /** AGENTS.md 是否本次写入（已存在/未填指令为 false）。 */
  agentsFile: boolean;
  error?: string;
}

export function prepareWorkspace(payload: { name: string; path?: string; instructions?: string }): Promise<PreparedWorkspace> {
  return bridgeRequest(
    "workspacePrepared",
    { path: "", agentsFile: false, error: "bridge unavailable" },
    (p) => {
      const r = p as { path?: string; agentsFile?: boolean; error?: string } | undefined;
      return { path: r?.path ?? "", agentsFile: !!r?.agentsFile, ...(r?.error ? { error: r.error } : {}) };
    },
    (reqId) => sendToShell({ type: "prepare-workspace", reqId, ...payload }),
  );
}

/* ── 编辑项目：覆写 <项目>/AGENTS.md。引擎的 /api/file 只读，写只能壳做；
   与 prepare-workspace 的区别是编辑是用户显式改，覆写而不是"已存在不改动"。 ── */

export interface AgentsWriteResult {
  ok: boolean;
  error?: string;
}

export function writeProjectAgents(payload: { path: string; instructions: string }): Promise<AgentsWriteResult> {
  return bridgeRequest(
    "agentsWritten",
    { ok: false, error: "bridge unavailable" },
    (p) => {
      const r = p as { ok?: boolean; error?: string } | undefined;
      return { ok: !!r?.ok, ...(r?.error ? { error: r.error } : {}) };
    },
    (reqId) => sendToShell({ type: "write-agents", reqId, ...payload }),
  );
}

export interface PickedAttachment {
  path: string;
  name: string;
  isDir: boolean;
  /** 图片：isImage=true 且带 base64（真字节上传）。其余文件同样带 base64
   *  （≤壳的 maxPickFileBytes，与桥的单请求上限一致）；超限/读取失败与
   *  文件夹一样只有路径，前端转 @ 引用（引擎宿主侧读盘）并当场说明。 */
  isImage?: boolean;
  base64?: string;
}

/** 壳侧附件选择器（composer ＋）：NSOpenPanel 文件+文件夹多选，回推绝对
 *  路径（图片另带 base64）。纯浏览器环境 resolve null；取消/超时 resolve
 *  空数组（超时视同取消，别让按钮停在等待态）。 */
export function pickAttachments(): Promise<PickedAttachment[] | null> {
  return bridgeRequest(
    "pickedAttachments",
    null,
    (p) => (p as { items?: PickedAttachment[] }).items ?? [],
    (reqId) => sendToShell({ type: "pick-attachments", reqId }),
  );
}

export function installHostBridge(handlers: Partial<{
  navigateToSession: (sessionId: string) => void;
  navigateToSettings: () => void;
  themeChanged: (dark: boolean) => void;
  /** 壳端目录选择器（＋新建空间）选定后的回推；取消时不推送。 */
  workspacePicked: (path: string) => void;
  /** 系统唤醒通知（PITFALLS §4.7）：WKWebView 里的 WS 可能已假死，
   *  前端据此弃掉 mux socket 重建，直播流自愈。 */
  systemWake: () => void;
  /** 菜单「文件 → 新建会话」：切到草稿页（与侧栏「新建会话」/⌘N 同一条路径）。 */
  newSession: () => void;
  /** 菜单「帮助 → 新手引导」：把引导卡再请出来（与首启那张同一份）。 */
  openOnboarding: () => void;
}> = {}): void {
  if (window.__deepDiveHost) return; // idempotent mount (StrictMode/reloads)
  window.__deepDiveHost = {
    dispatch(cmd: string, payload?: unknown) {
      switch (cmd) {
        case "navigateToSession": {
          const sessionId = (payload as { sessionId?: string } | undefined)?.sessionId;
          if (typeof sessionId === "string" && sessionId) handlers.navigateToSession?.(sessionId);
          break;
        }
        case "navigateToSettings": {
          handlers.navigateToSettings?.();
          break;
        }
        case "themeChanged": {
          const dark = (payload as { dark?: boolean } | undefined)?.dark ?? true;
          handlers.themeChanged?.(dark);
          break;
        }
        case "workspacePicked": {
          const path = (payload as { path?: string } | undefined)?.path;
          if (typeof path === "string" && path) handlers.workspacePicked?.(path);
          break;
        }
        case "systemWake": {
          handlers.systemWake?.();
          break;
        }
        case "newSession": {
          handlers.newSession?.();
          break;
        }
        case "openOnboarding": {
          handlers.openOnboarding?.();
          break;
        }
        default:
          break;
      }
      for (const cb of listeners) cb(cmd, payload);
    },
  };
  sendToShell({ type: "host-ready" });
}

/* ── 技能（设置 → 插件 → 技能）：技能根 `<DSH_HOME>/skills` 由引擎读写
   （`api.skillsAdmin`），壳只剩两件它才会做的事——开选目录 sheet、报出随应用
   发布的那几个技能名。 ── */

/** 让壳开一次选目录 sheet，只回挑中的目录；拷贝由引擎做（它才是技能根的主人）。 */
export function skillPickDirectory(): Promise<{ path?: string; cancelled: boolean }> {
  return bridgeRequest<{ path?: string; cancelled: boolean }>(
    "skillPickedDirectory",
    { cancelled: true },
    (p) => {
      const r = p as { path?: string; cancelled?: boolean } | undefined;
      return { path: r?.path, cancelled: r?.cancelled !== false };
    },
    (reqId) => sendToShell({ type: "skill-pick-directory", reqId }),
  );
}

/** 随应用发布、每次启动由壳幂等写回技能根的技能名：删了下次启动会回来，所以列表里
   不给删除入口。纯浏览器环境拿不到（桥不在），退化为一律可删。 */
export function appSkillNames(): Promise<string[]> {
  return bridgeRequest(
    "appSkillNames",
    [],
    (p) => {
      const r = p as { names?: string[] };
      return Array.isArray(r?.names) ? r.names : [];
    },
    (reqId) => sendToShell({ type: "app-skill-names", reqId }),
  );
}

/* ── 插件（设置 → 插件）：清单与开关落账都在引擎侧（`api.pluginInventory` /
   `api.pluginPatchList` / `api.pluginPatchSet`）。壳只剩「哪些插件随应用发布」——
   那是应用分发的事实，不是引擎的状态。 ── */

/** 随应用发布、每次启动被壳幂等装回来的插件名：这些删了也会回来，不给卸载入口。 */
export function pluginBundledNames(): Promise<string[]> {
  return bridgeRequest(
    "pluginAdminInfo",
    [],
    (p) => {
      const r = p as { bundled?: string[] };
      return Array.isArray(r?.bundled) ? r.bundled : [];
    },
    (reqId) => sendToShell({ type: "plugin-admin-info", reqId }),
  );
}

/** 卸载一个插件：摘掉 profile 依赖与 bundle 行。
    引擎的 bundle 成员有**启动边界**（README：running Profile keeps its Bundle set），
    改完必须重启引擎才生效——调用方负责调 restartEngine()。 */
export function pluginUninstall(moduleName: string): Promise<{ ok: boolean; error?: string }> {
  return bridgeRequest<{ ok: boolean; error?: string }>(
    "pluginUninstalled",
    { ok: false },
    (p) => {
      const r = p as { ok?: boolean; error?: string } | undefined;
      return { ok: r?.ok === true, error: r?.error };
    },
    (reqId) => sendToShell({ type: "plugin-uninstall", reqId, moduleName }),
  );
}

/** 重启引擎进程（stop + start）：换 bundle 集合、改运行时文件后靠它生效。 */
export function restartEngine(): void {
  sendToShell({ type: "restart-engine" });
}

/* ── MCP server（设置 → 插件 → MCP）：每个 server 一行 `@deepseek-ai/dsh-mcp-client`
   插进 profile 装配树，写在 home 级 patch 层的托管块里（与插件开关同一份文件）。
   引擎 patchReload:live 热重载，增删改与启停都不必重启。挂载形状见 docs/TODO.md §7。 ── */

export interface McpServerRow {
  /** 行 id（`mcp-<name>`）：启停开关的 patch 目标。 */
  rowId: string;
  /** serverName：模型侧工具名是 `mcp__<name>__<tool>`。 */
  name: string;
  /** 引擎 README 的取值，是 `streamable-http` 而不是 `http`。 */
  transport: "stdio" | "streamable-http";
  command: string;
  args: string[];
  url: string;
  /** 要注入的**环境变量名**（stdio）；值在壳的密钥表里，patch 只留引用。 */
  env: string[];
  /** 要注入的**请求头名**（streamable-http）；值同上。 */
  headers: string[];
  enabled: boolean;
}

export interface McpStore {
  servers: McpServerRow[];
  /** serverName → 已配置的密钥 key **名**（壳不回值，与模型 Key 同一条惯例）。 */
  configured: Record<string, string[]>;
}

export function mcpServersList(): Promise<McpStore> {
  return bridgeRequest<McpStore>(
    "mcpServers",
    { servers: [], configured: {} },
    (p) => {
      const r = p as { servers?: McpServerRow[]; configured?: Record<string, string[]> };
      return { servers: Array.isArray(r?.servers) ? r.servers : [], configured: r?.configured ?? {} };
    },
    (reqId) => sendToShell({ type: "mcp-servers-list", reqId }),
  );
}

/** 全量保存（增删改都走它）。`secrets` 只带**用户这次填了值**的密钥：
    壳会与已有值合并（填了就覆盖、不再被 env/headers 引用的 key 丢掉）。
    失败回原因（壳侧先校验名字与必填项）。 */
export function mcpServersSave(
  servers: McpServerRow[],
  secrets: Record<string, Record<string, string>>,
): Promise<{ ok: boolean; error?: string }> {
  return bridgeRequest<{ ok: boolean; error?: string }>(
    "mcpServersSaved",
    { ok: false },
    (p) => {
      const r = p as { ok?: boolean; error?: string } | undefined;
      return { ok: r?.ok === true, error: r?.error };
    },
    (reqId) => sendToShell({ type: "mcp-servers-save", reqId, servers, secrets }),
  );
}
