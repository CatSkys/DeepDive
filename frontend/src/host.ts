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

/** 壳侧目录列举（@ 引用候选源；引擎 browse 通道在桌面部署不可用，
 *  docs/DSH-WIRE.md §1）。纯浏览器环境 resolve 空数组。 */
export function listDir(path: string): Promise<Array<{ name: string; path: string; isDir: boolean }>> {
  return new Promise((resolve) => {
    if (!window.webkit?.messageHandlers?.deepdiveHost) {
      resolve([]);
      return;
    }
    const reqId = crypto.randomUUID();
    const off = onHostEvent((cmd, payload) => {
      if (cmd !== "dirListing") return;
      const p = payload as { reqId?: string; entries?: Array<{ name: string; path: string; isDir: boolean }>; error?: string };
      if (p.reqId !== reqId) return;
      off();
      resolve(p.error ? [] : p.entries ?? []);
    });
    sendToShell({ type: "list-dir", reqId, path });
  });
}

/** 壳侧工作区未提交改动摘要（run-git → gitStatus 回推）。引擎无 git 能力，
 *  这条链路只在桌面壳内可用；纯浏览器/非 git 仓库 resolve null。 */
export function gitStatus(path: string): Promise<import("./types").GitStatus | null> {
  return new Promise((resolve) => {
    if (!window.webkit?.messageHandlers?.deepdiveHost) {
      resolve(null);
      return;
    }
    const reqId = crypto.randomUUID();
    const off = onHostEvent((cmd, payload) => {
      if (cmd !== "gitStatus") return;
      const p = payload as { reqId?: string } & Partial<import("./types").GitStatus>;
      if (p.reqId !== reqId) return;
      off();
      resolve(p.repo === true ? (p as import("./types").GitStatus) : null);
    });
    sendToShell({ type: "run-git", reqId, path });
  });
}

/** 壳侧执行一条 git 子命令（git-run → gitRunResult 回推；参数数组直传
 *  Process，不经 shell）。切分支/提交/推送等胶囊动作共用此通道。 */
export function gitRun(path: string, args: string[]): Promise<{ ok: boolean; output: string } | null> {
  return new Promise((resolve) => {
    if (!window.webkit?.messageHandlers?.deepdiveHost) {
      resolve(null);
      return;
    }
    const reqId = crypto.randomUUID();
    const off = onHostEvent((cmd, payload) => {
      if (cmd !== "gitRunResult") return;
      const p = payload as { reqId?: string; ok?: boolean; output?: string };
      if (p.reqId !== reqId) return;
      off();
      resolve({ ok: !!p.ok, output: p.output ?? "" });
    });
    sendToShell({ type: "git-run", reqId, path, args });
  });
}

export interface PickedAttachment {
  path: string;
  name: string;
  isDir: boolean;
  /** 图片且字节读取成功时为 true，并带 base64（无前缀）——走真字节上传；
   *  其余类型只有路径，前端转 @ 引用（引擎宿主侧读盘）。 */
  isImage?: boolean;
  base64?: string;
}

/** 壳侧附件选择器（composer ＋）：NSOpenPanel 文件+文件夹多选，回推绝对
 *  路径（图片另带 base64）。纯浏览器环境 resolve null；取消 resolve 空数组。 */
export function pickAttachments(): Promise<PickedAttachment[] | null> {
  return new Promise((resolve) => {
    if (!window.webkit?.messageHandlers?.deepdiveHost) {
      resolve(null);
      return;
    }
    const reqId = crypto.randomUUID();
    const off = onHostEvent((cmd, payload) => {
      if (cmd !== "pickedAttachments") return;
      const p = payload as { reqId?: string; items?: PickedAttachment[] };
      if (p.reqId !== reqId) return;
      off();
      resolve(p.items ?? []);
    });
    sendToShell({ type: "pick-attachments", reqId });
  });
}

export function installHostBridge(handlers: {
  navigateToSession: (sessionId: string) => void;
  navigateToSettings: () => void;
  themeChanged: (dark: boolean) => void;
  /** 壳端目录选择器（＋新建空间）选定后的回推；取消时不推送。 */
  workspacePicked: (path: string) => void;
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
        default:
          break;
      }
      for (const cb of listeners) cb(cmd, payload);
    },
  };
  sendToShell({ type: "host-ready" });
}

