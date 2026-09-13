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
    webkit?: { messageHandlers?: { deepdiveHost?: { postMessage: (msg: unknown) => void } } };
  }
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

/** 用默认应用打开一个本地路径（0.1.5 产物三动作之一；壳 NSWorkspace.open）。 */
export function openPath(path: string): void {
  sendToShell({ type: "open-path", path });
}

/** 在 Finder 中定位一个本地路径（壳 activateFileViewerSelecting）。 */
export function revealPath(path: string): void {
  sendToShell({ type: "reveal-path", path });
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
    const reqId = crypto.randomUUID();
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

/* ── 自进化机械门（零人审的信任底座）：壳用随包 node 直跑固化脚本
 *  （lesson-gate / lesson-land / lesson-verify），模型不在环内——Ditto 的
 *  selftest 同款（宿主验证，不采信 agent 口头"完成"）。脚本由壳每次启动
 *  铺盘；这里只负责把 stdout 原样带回，回执解析在 evolution/protocol.ts。── */

export interface LessonToolResult {
  ok: boolean;
  /** 完整 stdout（回执在末行）。 */
  output: string;
}

export type LessonTool = "gate" | "land" | "verify";

/** 无壳桥/壳不回包/脚本缺席时 resolve null——调用方据此跳过该步（纯浏览器降级）。 */
export function lessonTool(tool: LessonTool, args: string[]): Promise<LessonToolResult | null> {
  return bridgeRequest(
    "lessonToolResult",
    null,
    (p) => {
      const r = p as { ok?: boolean; output?: string };
      if (r === undefined || r === null) return null;
      return { ok: !!r.ok, output: r.output ?? "" };
    },
    (reqId) => sendToShell({ type: "lesson-tool", reqId, tool, args }),
    60_000, // verify 要扫全部会话日志，给足时间
  );
}

/** 壳侧引擎目录（$DSH_HOME）：home 作用域会话创建时的 cwd——沙箱 workspaceRoot
 *  即会话 cwd，这是 skill/global 落库的机械写边界。纯浏览器 resolve null。 */
export function evolutionEnv(): Promise<{ harnessHome: string } | null> {
  return bridgeRequest(
    "evolutionEnv",
    null,
    (p) => {
      const r = p as { harnessHome?: string };
      return typeof r?.harnessHome === "string" && r.harnessHome !== "" ? { harnessHome: r.harnessHome } : null;
    },
    (reqId) => sendToShell({ type: "evolution-env", reqId }),
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

export interface PickedAttachment {
  path: string;
  name: string;
  isDir: boolean;
  /** 图片：isImage=true 且带 base64（真字节上传）。0.1.5 起非图片文件
   *  ≤8MB 也附 base64（fileUploads/upload 真上传）；超限/读取失败与文件
   *  夹一样只有路径，前端转 @ 引用（引擎宿主侧读盘）。 */
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

export function installHostBridge(handlers: {
  navigateToSession: (sessionId: string) => void;
  navigateToSettings: () => void;
  themeChanged: (dark: boolean) => void;
  /** 壳端目录选择器（＋新建空间）选定后的回推；取消时不推送。 */
  workspacePicked: (path: string) => void;
  /** 系统唤醒通知（PITFALLS §4.7）：WKWebView 里的 WS 可能已假死，
   *  前端据此弃掉 mux socket 重建，直播流自愈。 */
  systemWake: () => void;
}): void {
  if (window.__deepDiveHost) return; // idempotent mount (StrictMode/reloads)
  window.__deepDiveHost = {
    dispatch(cmd: string, payload?: unknown) {
      switch (cmd) {
        case "navigateToSession": {
          const sessionId = (payload as { sessionId?: string } | undefined)?.sessionId;
          if (typeof sessionId === "string" && sessionId) handlers.navigateToSession(sessionId);
          break;
        }
        case "navigateToSettings": {
          handlers.navigateToSettings();
          break;
        }
        case "themeChanged": {
          const dark = (payload as { dark?: boolean } | undefined)?.dark ?? true;
          handlers.themeChanged(dark);
          break;
        }
        case "workspacePicked": {
          const path = (payload as { path?: string } | undefined)?.path;
          if (typeof path === "string" && path) handlers.workspacePicked(path);
          break;
        }
        case "systemWake": {
          handlers.systemWake();
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

