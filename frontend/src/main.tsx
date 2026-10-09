import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ComposerOverlayApp } from "./sidebar-right/ComposerOverlay";
import { initTitlebarBridge } from "./titlebar";
import { initNativeSlotBridge } from "./nativeSlot";
import { initChatFloatBridge } from "./sidebar-right/useComposerOverlay";
import { installHoverArming } from "./hoverArming";
import { inShell } from "./host";

// 叠加层入口：壳在浏览器页之上叠的那层透明 webview 用 `?composer=<sid>` 打开同一个包，
// 只渲染输入框（悬浮在全屏网页上）。**不装**顶条与原生槽位桥——那两个是主窗口那一份的事，
// 叠加层再推一份 rect 表会把主 SPA 的顶条命中区打乱。
const overlaySession = new URLSearchParams(window.location.search).get("composer");

if (overlaySession !== null && overlaySession !== "") {
  document.documentElement.dataset.overlay = "1";
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ComposerOverlayApp sessionId={overlaySession} />
    </React.StrictMode>
  );
} else {
  initTitlebarBridge();
  // 原生视图槽位（侧栏浏览器的 WKWebView 载体）：把标记了 data-native-slot 的元素 rect
  // 推给壳。无壳桥时它自己 no-op（纯浏览器走 iframe 载体）。
  initNativeSlotBridge();
  // 对话卡的开关态（壳在每次显隐变化时推 `chatFloat`）：装在这里而不是那颗胶囊上——
  // 面板收起时胶囊是卸掉的，装在那儿会漏掉壳推来的状态。
  initChatFloatBridge();
  // 悬停点亮：行/菜单的 hover 只响应指针主动移动（复位时机见 hoverArming.ts）。
  // 只装主 SPA 这一份——叠加层里没有门控过的行。
  installHoverArming();

  // 首帧前标明"是否在壳里"：窗口 chrome（红绿灯 + 标题栏条）只有壳里有，CSS 据此
  // 决定顶部两钮贴不贴左、会话头让位多少。放在渲染之前，避免先按壳里排一帧再跳位。
  if (inShell()) {
    document.documentElement.dataset.shell = "1";
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
