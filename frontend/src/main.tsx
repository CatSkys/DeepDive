import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initTitlebarBridge } from "./titlebar";
import { initNativeSlotBridge } from "./nativeSlot";
import { inShell } from "./host";

initTitlebarBridge();
// 原生视图槽位（侧栏浏览器的 WKWebView 载体）：把标记了 data-native-slot 的元素 rect
// 推给壳。无壳桥时它自己 no-op（纯浏览器走 iframe 载体）。
initNativeSlotBridge();

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
