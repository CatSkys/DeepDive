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

/** 透明带占面板网页那一格的高度比例：卡片的生长上限，页面本身不被它遮住（卡与输入框
    之外是透明的，点击照样透传）。 */
const STRIP_RATIO = 0.7;

/** 返回"浏览器是否正全屏"——调用方据此收起会话自己那份输入框。 */
export function useComposerOverlay(sessionId: string): boolean {
  const surface = usePanelSurface(sessionId);
  const active = surface.open && surface.fullscreen && surface.mode === "browser";

  useEffect(() => {
    if (!active) {
      sendToShell({ type: "composer-overlay", sessionId: null });
      return;
    }
    const push = () => {
      const body = document.querySelector('.panel[data-fullscreen="true"] .panel-browser-body');
      const rect = body?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      const height = Math.round(rect.height * STRIP_RATIO);
      sendToShell({
        type: "composer-overlay",
        sessionId,
        rect: { x: rect.left, y: rect.bottom - height, w: rect.width, h: height },
      });
    };
    push();
    const timer = window.setInterval(push, 300);
    window.addEventListener("resize", push);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", push);
      sendToShell({ type: "composer-overlay", sessionId: null });
    };
  }, [active, sessionId]);

  return active;
}
