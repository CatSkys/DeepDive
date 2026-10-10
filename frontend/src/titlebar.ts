// Window-drag bridge (shell contract: apps/macos …/MainWindowController.swift).
//
// The WKWebView lets blank space in the top strip fall through to a native
// drag handle. To keep real controls clickable it needs a rect table of every
// interactive element intersecting that strip, pushed from here. Coordinates
// are CSS viewport coords (getBoundingClientRect, y-down) — the shell converts
// the hit-test point itself, so no viewport height is exchanged and none can
// go stale.
//
// A stale table swallows clicks on real buttons (sidebar slide, menus,
// reflows), so push on a short interval AND on every layout-affecting event.
// Until the first table arrives the shell fails open: nothing is draggable
// and nothing is swallowed.

// Rect 表差分：壳的 hitTest 拿的是上次推来的表，逐拍推送**相同**的表是纯流量
// （每条 bridge 消息都是一次 WKScriptMessageHandler 的完整反序列化）。表内容
// 不变时不发；扫描节拍保持 300ms——transitionend 盖不住"无过渡的重排"，
// interval 仍是安全网，差分只省下推送成本。

import { sendRects } from "./host";

const STRIP_HEIGHT = 52; // keep in sync with TitlebarAwareWebView.dragStripHeight
const PUSH_INTERVAL_MS = 300;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BridgeHost {
  webkit?: { messageHandlers?: { deepdive?: { postMessage(msg: unknown): void } } };
}

/** 壳桥在不在（rect 表通道）：纯浏览器里全部静默降级。 */
function bridgeUp(): boolean {
  return !!((window as unknown as BridgeHost).webkit?.messageHandlers?.deepdive);
}

// data-strip-interactive: 非控件但必须可在顶条内交互的元素（侧栏拖拽
// 调宽热区）——不加会被"空白条带 = 拖窗"契约吃掉上段热区。
const INTERACTIVE = "button, a, input, textarea, select, [role='button'], [data-strip-interactive]";

let lastSig = "";

function pushRects() {
  if (!bridgeUp()) return;
  const rects: Rect[] = [];
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    // Only elements that reach into the strip matter; the rest never hit it.
    if (r.top >= STRIP_HEIGHT || r.bottom <= 0 || r.right <= 0 || r.left >= window.innerWidth) continue;
    rects.push({ x: r.x, y: r.y, w: r.width, h: r.height });
  }
  const sig = JSON.stringify(rects);
  if (sig === lastSig) return;
  lastSig = sig;
  sendRects({ type: "titlebar-rects", rects });
}

export function initTitlebarBridge(): void {
  if (!bridgeUp()) return; // plain browser (dev / Playwright): nothing to bridge
  pushRects();
  // React mounts after this script; catch the window-top buttons late.
  for (const delay of [300, 800, 1500]) setTimeout(pushRects, delay);
  window.addEventListener("resize", pushRects);
  // Sidebar slide, sheets, any CSS transition that moves strip controls.
  document.addEventListener("transitionend", pushRects, true);
  // Menus and re-renders without transitions — the interval is the safety net.
  const iv = setInterval(pushRects, PUSH_INTERVAL_MS);
  window.addEventListener("pagehide", () => clearInterval(iv));
}
