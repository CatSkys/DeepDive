import { uuid } from "./uuid";
import { narrowReviewChanges, narrowReviewDiff } from "./review/gitChangesModel";
import type { ReviewChanges, ReviewDiff } from "./review/types";
import {
  inShell as platformInShell,
  mountShellDispatch,
  sendRects as platformSendRects,
  sendToShell as platformSendToShell,
} from "./platform";
// Shell↔frontend bridge mount (SPEC-NOTIFICATIONS §3.1).
//
// The native shell pushes instructions to `window.__deepDiveHost.dispatch(cmd, payload)`
//（mac 走 evaluateJavaScript；Windows 壳经 chrome.webview 事件由 platform 转投）;
// the frontend reports the mounted hook with a `host-ready` message. The shell
// stages at most one pending command until this hook reports ready, so a
// notification tap during cold start is never lost. Degradation: in a plain
// browser everything here no-ops silently — the bridge is an enhancement, not
// a dependency.

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

/** 是否跑在壳里（壳桥在）：窗口 chrome 只有壳里有，main.tsx 据此标 `<html data-shell>`。 */
export function inShell(): boolean {
  return platformInShell();
}

type HostEvent = (cmd: string, payload?: unknown) => void;
const listeners = new Set<HostEvent>();

export function onHostEvent(cb: HostEvent): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function sendToShell(message: Record<string, unknown>): void {
  platformSendToShell(message);
}

/** 「rect 表」通道：顶条控件 rect 与原生槽位 rect 共用，300ms 一推、量大且无应答
 *  ——与指令通道分开是壳侧按 channel 分派的既有契约（mac 双 handler；Windows 壳
 *  两通道合一、type 区分）。发错通道不会报错：壳那边只是"没人接"。 */
export function sendRects(message: Record<string, unknown>): void {
  platformSendRects(message);
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

/* ── 会话维护：取消归档 / 删除都在引擎侧（`api.workspaceUnarchiveSessions` /
   `api.sessionDeleteSessions`，见 docs/TODO.md §18 的收口记录）。壳这里只剩
   通知侧的"别打扰"：哪些会话是机器会话，壳不该替它弹通知。 ── */

/** 告诉壳哪些会话不该打扰用户（后台会话的"完成"不弹通知、不点亮药丸状态点）。
 *  判据的唯一事实源在前端（session/backgroundSession），壳只照做。 */
export function setQuietSessions(ids: string[]): void {
  sendToShell({ type: "quiet-sessions", ids });
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
    if (!platformInShell()) {
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

/* ── 审查面板（GitChanges）──────────────────────────────────────────
   另开两条通道而不复用 git-run：那条给动作用的，输出只留 4000 字符**尾部**供人
   读，diff patch 传不过来（截尾还会切出解析错误的 patch）。git 参数全写死在壳侧，
   前端不透传任意 args。── */

/** 未暂存改动清单。纯浏览器环境 resolve 空表（repo=false），调用方按"没有 git
 *  数据"处理，不报错。 */
export function gitChanges(path: string): Promise<ReviewChanges> {
  return bridgeRequest(
    "gitChangesResult",
    { repo: false, branch: "", files: [] },
    narrowReviewChanges,
    (reqId) => sendToShell({ type: "git-changes", reqId, path }),
  );
}

/** 单文件 diff。kind 交给调用方分流：patch 走解析器，其余各是一句说明。 */
export function gitDiff(path: string, file: string): Promise<ReviewDiff> {
  return bridgeRequest(
    "gitDiffResult",
    { kind: "unavailable" as const, patch: "", content: "" },
    narrowReviewDiff,
    (reqId) => sendToShell({ type: "git-diff", reqId, path, file }),
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
  /** **图片**才有 isImage + base64（要随 prompt 内联给模型看，≤壳的内联上限）。
   *  其余一律只有路径：前端拿它请壳按路径流式上传（`uploadAttachmentPath`，
   *  桥不参与、没有大小上限），文件夹则转 @ 引用。 */
  isImage?: boolean;
  base64?: string;
  /** 文件字节数（非目录时都有）：chip 立刻显示大小，不用等上传回来。 */
  bytes?: number;
}

/** 壳侧附件选择器（composer ＋ 菜单的两项）：`kind` 决定挑文件还是文件夹，
 *  回推绝对路径（图片另带 base64）。纯浏览器环境 resolve null；取消/超时
 *  resolve 空数组（超时视同取消，别让按钮停在等待态）。 */
export function pickAttachments(kind: "files" | "folders"): Promise<PickedAttachment[] | null> {
  return bridgeRequest(
    "pickedAttachments",
    null,
    (p) => (p as { items?: PickedAttachment[] }).items ?? [],
    (reqId) => sendToShell({ type: "pick-attachments", reqId, kind }),
  );
}

/** 上传回执（与 `api.uploadFileStreaming` 同形：壳那条 /api 路由的 `{ok,value}`）。 */
export interface AttachmentUploadReceipt {
  receiptId: string;
  file: { attachmentId: string; name: string; bytes: number };
}

/** 请**壳**按路径上传一个附件（选择器挑中的文件走这条）。
 *
 *  为什么不让页面传字节：SPA 只有两种法子——整段塞进一次请求（桥按缓冲上限处理，
 *  超过上限就得落盘再转发），或者把整个文件 base64 进一条桥消息（随大小线性吃内存）。
 *  壳有路径，可以 `uploadTask(fromFile:)` 按块读盘**流式**送给引擎：内存与文件大小
 *  无关，几百 MB 照样发得出去。
 *  失败时 resolve null（壳回 ok:false 或超时），由 chip 显示失败原因并可重试。 */
export function uploadAttachmentPath(path: string, sessionId: string, name: string): Promise<AttachmentUploadReceipt | null> {
  return bridgeRequest(
    "attachmentUploaded",
    null,
    (p) => {
      const payload = p as { ok?: boolean; value?: AttachmentUploadReceipt };
      return payload.ok && payload.value ? payload.value : null;
    },
    (reqId) => sendToShell({ type: "upload-path", reqId, path, sessionId, name }),
    // 大文件要读完整个文件再送进引擎：给足时间（本地盘 + 本机引擎，仍很快）
    120_000,
  );
}

/* ── 截图与划词（Atd 移植）：截图整段会话在壳里跑（冻结屏幕/选区/标注），回来的是与
   附件选择器同形的 items（图片内联 base64、屏幕上下文按路径）——摄入路径复用 ＋ 选择器
   那一份（`ingestPicked`）。划词的选中文字走「读一次」请求，工具条设置整份推给壳。 ── */

/** 一次截图的结果：成功给附件项（与选择器同形），失败给壳的成品文案。
 *  失败**必须**让调用方看见——静默 resolve null 会把"权限没生效/采集失败"
 *  这类真话说没（2026-10-13 实机：授权后截图打不开，界面毫无反应）。 */
export type ScreenshotResult =
  | { ok: true; items: PickedAttachment[] }
  | { ok: false; error: string };

function parseShot(p: unknown): ScreenshotResult {
  const r = p as { ok?: boolean; items?: PickedAttachment[]; error?: string } | undefined;
  if (r?.ok) return { ok: true, items: r.items ?? [] };
  return { ok: false, error: r?.error ?? "" };
}

/** 请壳截一张图（`screenshot-capture`）；用户取消也是一个 `ok:false`（error 为空）。
 *  用户要拖选区与标注，给足时限（桥的超时只是兜底）。 */
export function screenshotCapture(): Promise<ScreenshotResult> {
  return bridgeRequest(
    "screenshotCaptured",
    { ok: false, error: "" },
    parseShot,
    (reqId) => sendToShell({ type: "screenshot-capture", reqId }),
    600_000,
  );
}

/** 重开一张已存图片继续编辑（`screenshot.edit`）；同样回附件项。 */
export function screenshotEdit(path: string): Promise<ScreenshotResult> {
  return bridgeRequest(
    "screenshotCaptured",
    { ok: false, error: "" },
    parseShot,
    (reqId) => sendToShell({ type: "screenshot-edit", reqId, path }),
    600_000,
  );
}

/** 两处授权现在的状态（设置页据此显示「已授权」）。 */
export function permissionsState(): Promise<{ accessibility: boolean; screenRecording: boolean }> {
  return bridgeRequest(
    "permissionsState",
    { accessibility: false, screenRecording: false },
    (p) => {
      const r = p as { accessibility?: boolean; screenRecording?: boolean } | undefined;
      return { accessibility: r?.accessibility === true, screenRecording: r?.screenRecording === true };
    },
    (reqId) => sendToShell({ type: "permissions-state", reqId }),
  );
}

/** 读一次前台应用里选中的文字（`selection-capture`）；读不到（无选区/未授权）resolve null。 */
export function selectionCapture(): Promise<{ text: string; capturedAt: string } | null> {
  return bridgeRequest(
    "selectionCaptured",
    null,
    (p) => {
      const r = p as { ok?: boolean; value?: { text: string; capturedAt: string } } | undefined;
      return r?.ok && r.value ? r.value : null;
    },
    (reqId) => sendToShell({ type: "selection-capture", reqId }),
    10_000,
  );
}

/** 把整份选区工具条设置推给壳（壳存偏好并立即生效；不回执）。 */
export function selectionToolbarSet(settings: Record<string, unknown>): void {
  sendToShell({ type: "selection-toolbar-set", settings });
}

/** toggle 模式的监听开合（工具条 HUD 与状态菜单据此显示）。 */
export function selectionSetListening(on: boolean): void {
  sendToShell({ type: "selection-listening", on });
}

/** 选一批「不显示选区工具条」的 App（壳开系统选 App 面板）。 */
export function selectionAppsPick(): Promise<Array<{ bundleId: string; name: string }>> {
  return bridgeRequest(
    "appsPicked",
    [],
    (p) => (p as { apps?: Array<{ bundleId: string; name: string }> } | undefined)?.apps ?? [],
    (reqId) => sendToShell({ type: "selection-apps-pick", reqId }),
    120_000,
  );
}

/** 打开系统设置的辅助功能面板（工具条要这项授权）。 */
export function openAccessibilitySettings(): void {
  sendToShell({ type: "accessibility-request" });
}

/** 请求屏幕录制授权（截图要这项授权）。 */
export function requestScreenRecording(): void {
  sendToShell({ type: "screen-recording-request" });
}

export function installHostBridge(handlers: Partial<{
  navigateToSession: (sessionId: string) => void;
  navigateToSettings: () => void;
  /** 迷你面板「新会话」：快捷会话空间新草稿（D14）。壳只推给迷你面板页
   *  （#/mini）；主窗的桥不装这两个入口。 */
  openQuickSession: () => void;
  /** 迷你面板命令卡运行：命令名回来预填当前输入框，执行链仍走 Composer/引擎。 */
  runQuickCommand: (payload: { name: string }) => void;
  /** 壳把面板带到前台后（makeKey + 0.15s）推来：迷你面板页的输入框拿键盘。 */
  quickPanelFocus: () => void;
  /** 命令中心卡那一页（`?minicc=1`）专用的两条：**开哪张脸**（模式 + 会话 id，设置行集
   *  按脸给）与**用户要关**（卡那页按了 Esc——开合的事实源在面板页，壳只转发）。 */
  miniCCFace: (payload: { mode: string; sessionId: string | null }) => void;
  miniCCClosed: () => void;
  /** 壳端目录选择器（＋新建空间）选定后的回推；取消时不推送。 */
  workspacePicked: (path: string) => void;
  /** 系统唤醒通知（PITFALLS §4.7）：WKWebView 里的 WS 可能已假死，
   *  前端据此弃掉 mux socket 重建，直播流自愈。 */
  systemWake: () => void;
  /** 菜单「文件 → 新建会话」：切到草稿页（与侧栏「新建会话」/⌘N 同一条路径）。 */
  newSession: () => void;
  /** 菜单「帮助 → 新手引导」：把引导卡再请出来（与首启那张同一份）。 */
  openOnboarding: () => void;
  /** 截图到了（全局热键或迷你面板条目发起，没有请求方）：items 与附件选择器同形，
   *  按既有摄入路径建 chip。带 reqId 的不走这里（那是 `screenshotCapture()` 的应答）。 */
  onScreenshotArrived: (items: PickedAttachment[]) => void;
  /** 截图进了剪贴板（复制路径）。 */
  onScreenshotCopied: () => void;
  /** 屏幕录制未授权，截图没跑起来。 */
  onScreenRecordingDenied: () => void;
  /** 工具条上的「问 DeepDive」：文字已在壳里暂存，这里读它并引用进草稿。 */
  onSelectionAsk: () => void;
  /** toggle 模式监听状态变了。 */
  onSelectionListening: (on: boolean) => void;
  /** 辅助功能授权状态变了。 */
  onAccessibilityTrust: (trusted: boolean) => void;
  /** 屏幕录制授权状态变了。 */
  onScreenRecordingTrust: (trusted: boolean) => void;
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
        case "openQuickSession": {
          handlers.openQuickSession?.();
          break;
        }
        case "runQuickCommand": {
          const p = (payload ?? {}) as { name?: string };
          handlers.runQuickCommand?.({ name: p.name ?? "" });
          break;
        }
        case "miniCCFace": {
          const p = (payload ?? {}) as { mode?: string; sessionId?: string | null };
          handlers.miniCCFace?.({ mode: p.mode ?? "", sessionId: p.sessionId ?? null });
          break;
        }
        case "miniCCClosed": {
          handlers.miniCCClosed?.();
          break;
        }
        case "quickPanelFocus": {
          handlers.quickPanelFocus?.();
          break;
        }
        case "navigateToSettings": {
          handlers.navigateToSettings?.();
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
        case "screenshotCaptured": {
          const p = payload as { reqId?: string; items?: PickedAttachment[] } | undefined;
          if (!p?.reqId) handlers.onScreenshotArrived?.(p?.items ?? []);
          break;
        }
        case "screenshotCopied": {
          handlers.onScreenshotCopied?.();
          break;
        }
        case "screenRecordingDenied": {
          handlers.onScreenRecordingDenied?.();
          break;
        }
        case "selectionAsk": {
          handlers.onSelectionAsk?.();
          break;
        }
        case "selectionListening": {
          handlers.onSelectionListening?.((payload as { on?: boolean } | undefined)?.on === true);
          break;
        }
        case "screenRecordingTrust": {
          handlers.onScreenRecordingTrust?.(
            (payload as { trusted?: boolean } | undefined)?.trusted === true);
          break;
        }
        case "accessibilityTrust": {
          handlers.onAccessibilityTrust?.(
            (payload as { trusted?: boolean } | undefined)?.trusted === true);
          break;
        }
        default:
          break;
      }
      for (const cb of listeners) cb(cmd, payload);
    },
  };
  // Windows 壳的推送走 chrome.webview 事件，接到同一个 dispatch（mac 由
  // evaluateJavaScript 直调，注册是 no-op）。
  mountShellDispatch((cmd, payload) => {
    window.__deepDiveHost?.dispatch(cmd, payload);
  });
  sendToShell({ type: "host-ready" });
}

/* ── 技能（设置 → 插件 → 技能）：技能根 `<DSH_HOME>/skills` 由引擎读写
   （`api.skillsAdmin`），随应用发布的那两个技能由引擎**运行时注册**（不是文件，
   所以也不出现在清单里）。壳只剩它才会做的一件事：开选目录 sheet。 ── */

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
