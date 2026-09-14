import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initTitlebarBridge } from "./titlebar";
import { inShell } from "./host";

initTitlebarBridge();

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
