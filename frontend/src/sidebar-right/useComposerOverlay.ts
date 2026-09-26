// 浏览器全屏时的悬浮输入框：**主 SPA 这一侧的编排**（谁该显示、摆在哪、会话自己那份收起）。
//
// 叠加层本体是壳里另一个透明 webview（`ComposerOverlay.tsx` 那一支）；这里只负责：
//   · 进出浏览器全屏时告诉壳"给哪个会话显示 / 收起"；
//   · 算那条透明带的 rect——它知道面板网页那一格的几何（`.panel-browser-body`）。
// 带子给足高度：胶囊多行时在带内向上生长；点击能不能穿透由页面上报的胶囊矩形决定，
// 不靠这条带子的大小。
import { useEffect } from "react";
import { sendToShell } from "../host";
import { usePanelSurface } from "./panelStore";

/** 电脑上那颗「对话」按钮的入口：把叠加层叫出来（卡片位置由叠加层自己记）。
    顶栏按钮与"进全屏自动叫一次"共用它，避免两处各写一套消息。 */
export function showChatFloat(sessionId: string): void {
  const body = document.querySelector('.panel[data-fullscreen="true"] .panel-browser-body') ?? document.querySelector(".panel-browser-body");
  const rect = body?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return;
  sendToShell({
    type: "composer-overlay",
    sessionId,
    rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
  });
}

/** 返回"浏览器是否正全屏"——调用方据此收起会话自己那份输入框。
    离开浏览器页时把叠加层收掉（对话框属于浏览器页）。 */
export function useComposerOverlay(sessionId: string): boolean {
  const surface = usePanelSurface(sessionId);
  const active = surface.open && surface.mode === "browser";

  useEffect(() => {
    if (!active) sendToShell({ type: "composer-overlay", sessionId: null });
    return () => { sendToShell({ type: "composer-overlay", sessionId: null }); };
  }, [active, sessionId]);

  return surface.open && surface.fullscreen && surface.mode === "browser";
}
