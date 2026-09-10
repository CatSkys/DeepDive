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

