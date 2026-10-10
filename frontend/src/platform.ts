// 壳桥的平台入口（PLAN-WINDOWS §7.1）：SPA 只经这里摸壳通道与平台事实。
//
// mac：`webkit.messageHandlers`（deepdiveHost 指令 / deepdive rect 双通道），
//      壳→前端走 evaluateJavaScript 调 __deepDiveHost.dispatch。
// Windows：`chrome.webview` 单通道（postMessage + message 事件，type 字段区分），
//      壳→前端走 PostWebMessageAsJson({cmd, payload})，由 mountShellDispatch 转投。
//
// 能力清单（§7.2）：壳没实现的能力在此归 false，判定点只读这里——
// "在壳里"与"壳有这个能力"是两回事（Windows 壳第一期没有浏览器栈，
// 若只判 inShell，浏览器面板的原生槽位后面什么都没有）。

interface WebkitHandlers {
  deepdiveHost?: { postMessage(msg: unknown): void };
  deepdive?: { postMessage(msg: unknown): void };
}

interface ChromeWebviewLike {
  postMessage(msg: unknown): void;
  addEventListener(type: "message", cb: (e: { data: unknown }) => void): void;
  removeEventListener(type: "message", cb: (e: { data: unknown }) => void): void;
}

function webkitHandlers(): WebkitHandlers | undefined {
  return (window as unknown as { webkit?: { messageHandlers?: WebkitHandlers } }).webkit?.messageHandlers;
}

function chromeWebview(): ChromeWebviewLike | undefined {
  return (window as unknown as { chrome?: { webview?: ChromeWebviewLike } }).chrome?.webview;
}

/** 操作系统层平台（与"在不在壳里"无关：纯浏览器调试也按 OS 取键位显示）。 */
export const IS_WINDOWS_OS: boolean = navigator.userAgent.includes("Windows");

/** 是否跑在壳里（任一平台的壳桥在）。窗口 chrome（自绘标题栏）只有壳里有。 */
export function inShell(): boolean {
  return !!webkitHandlers()?.deepdiveHost || !!chromeWebview();
}

/** SPA → 壳：指令通道（host.ts 全部壳消息走这里）。 */
export function sendToShell(message: Record<string, unknown>): void {
  const mac = webkitHandlers()?.deepdiveHost;
  if (mac) {
    mac.postMessage(message);
    return;
  }
  chromeWebview()?.postMessage(message);
}

/** SPA → 壳：rect 表通道（titlebar/nativeSlot）。Windows 壳两通道合一，type 区分；
 *  Windows 侧的 titlebar-rects/native-slot 没有消费者，发了即忽略（mac 契约不变）。 */
export function sendRects(message: Record<string, unknown>): void {
  const mac = webkitHandlers()?.deepdive;
  if (mac) {
    mac.postMessage(message);
    return;
  }
  chromeWebview()?.postMessage(message);
}

/** rect 表通道在不在（titlebar.ts 的降级判定）。 */
export function hasRectChannel(): boolean {
  return !!webkitHandlers()?.deepdive || !!chromeWebview();
}

/** 壳→前端推送（Windows 通道）：转投 __deepDiveHost.dispatch(cmd, payload)。
 *  mac 壳走 evaluateJavaScript，不走事件——注册是 no-op。返回注销函数。 */
export function mountShellDispatch(handler: (cmd: string, payload: unknown) => void): () => void {
  const webview = chromeWebview();
  if (!webview) return () => {};
  const listener = (e: { data: unknown }) => {
    const msg = e.data as { cmd?: string; payload?: unknown } | null;
    if (!msg || typeof msg.cmd !== "string") return;
    handler(msg.cmd, msg.payload);
  };
  webview.addEventListener("message", listener);
  return () => webview.removeEventListener("message", listener);
}

/* ── 能力清单 ───────────────────────────────────────────────────── */

export interface ShellCapabilities {
  /** 侧栏浏览器的原生栈（Windows 壳第一期无 → 浏览器面板落空态）。 */
  browser: boolean;
  /** 壳侧听写（SFSpeechRecognizer / WinRT）。 */
  dictation: boolean;
  /** 移动端远程面（配对/二维码/台账）。 */
  remote: boolean;
  /** 文本 → 二维码（Bot Channel 扫码配对）。 */
  qr: boolean;
  /** 读其他 Agent 模型配置原文（新手引导"迁移"步）。 */
  agentImport: boolean;
  /** "打开方式"候选清单（全屏预览页右上）。 */
  openWith: boolean;
  /** 全局热键录制窗。 */
  hotkeyRecorder: boolean;
}

const MAC_CAPABILITIES: ShellCapabilities = {
  browser: true,
  dictation: true,
  remote: true,
  qr: true,
  agentImport: true,
  openWith: true,
  hotkeyRecorder: true,
};

/** Windows 壳第一期能力面（DeepDive-win 交付说明为准，随壳补齐逐项翻 true）。 */
const WINDOWS_V1_CAPABILITIES: ShellCapabilities = {
  browser: false,
  dictation: false,
  remote: false,
  qr: false,
  agentImport: false,
  openWith: false,
  hotkeyRecorder: false,
};

const NO_SHELL_CAPABILITIES: ShellCapabilities = MAC_CAPABILITIES;

export function shellCapabilities(): ShellCapabilities {
  if (!inShell()) return NO_SHELL_CAPABILITIES;
  return IS_WINDOWS_OS ? WINDOWS_V1_CAPABILITIES : MAC_CAPABILITIES;
}
