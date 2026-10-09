// 浏览器全屏时的悬浮输入框：**主 SPA 这一侧的编排**（谁该显示、摆在哪、会话自己那份收起）。
//
// 叠加层本体是壳里另一个透明 webview（`ComposerOverlay.tsx` 那一支）；这里只负责：
//   · 进出浏览器全屏时告诉壳"给哪个会话显示 / 收起"；
//   · 算那条透明带的 rect——它知道面板网页那一格的几何（`.panel-browser-body`）；
//   · 存一份"卡片是否开着"的**镜像**给地址栏那颗 Chat 胶囊显示开关态。
// 带子给足高度：胶囊多行时在带内向上生长；点击能不能穿透由页面上报的胶囊矩形决定，
// 不靠这条带子的大小。
import { useEffect, useSyncExternalStore } from "react";
import { onHostEvent, sendToShell } from "../host";
import { usePanelSurface } from "./panelStore";

/** 电脑上那颗「对话」按钮的开关入口：显隐的事实源在壳（卡片自己的 × 也归它收），
    SPA 不留第二份可见状态——会跟卡上的 × 失同步。这边只带 rect，壳按自己记的
    可见性翻转；卡片位置由叠加层自己记。 */
export function toggleChatFloat(sessionId: string): void {
  const body = document.querySelector('.panel[data-fullscreen="true"] .panel-browser-body') ?? document.querySelector(".panel-browser-body");
  const rect = body?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return;
  sendToShell({
    type: "composer-overlay",
    sessionId,
    toggle: true,
    rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
  });
}

// ── 开关态的镜像 ──────────────────────────────────────────────
// 上面那条"不留第二份可见状态"说的是 SPA **不自己翻转**（自己记就会与壳失同步）；
// 但胶囊要显示开/关，读的仍是壳——壳在每次显隐变化时推 `chatFloat` 下来，这里只存
// 这一份被动镜像。全局一份而不是按会话：同屏只允许一个活着的 composer。

let chatFloatOpen = false;
const chatFloatListeners = new Set<() => void>();

function setChatFloatOpen(next: boolean): void {
  // 同值不通知：useSyncExternalStore 的 getSnapshot 必须稳定，否则每次推送都白重渲一轮
  if (chatFloatOpen === next) return;
  chatFloatOpen = next;
  for (const listener of chatFloatListeners) listener();
}

/** 读"对话卡是否正开着"（订阅式）。消费方自己重渲，不碰真值。 */
export function useChatFloatOpen(): boolean {
  return useSyncExternalStore(
    (listener) => { chatFloatListeners.add(listener); return () => { chatFloatListeners.delete(listener); }; },
    () => chatFloatOpen,
  );
}

/** 装一次壳推来的显隐变化（`main.tsx` 开机调）。**不在胶囊上装**：面板收起时那颗钮
    是卸掉的，那时壳推来的"已收起"就丢了，再打开面板会显示成还开着。 */
export function initChatFloatBridge(): void {
  onHostEvent((cmd, payload) => {
    if (cmd !== "chatFloat") return;
    setChatFloatOpen((payload as { open?: boolean } | undefined)?.open === true);
  });
}

/** 返回"浏览器是否正全屏"——调用方据此收起会话自己那份输入框。
    不在浏览器全屏时一律叫壳收起叠加层：那一层是**透明 webview，只在页面报上来的
    胶囊矩形里收点击**，留着可见就有一个看不见的死区压在会话框右端（停止钮、排队行的
    操作钮正好在那儿——用户报"网页能点、端上点不动"）。收起条件是"浏览器全屏"，
    不是"面板开着浏览器页"：面板退回侧栏槽位时（仍开着浏览器页）本组件返回 false、
    会话自己那份输入框会重新画出来，此时叠加层必须让位。 */
export function useComposerOverlay(sessionId: string): boolean {
  const surface = usePanelSurface(sessionId);
  const browserFullscreen = surface.open && surface.fullscreen && surface.mode === "browser";

  useEffect(() => {
    if (!browserFullscreen) sendToShell({ type: "composer-overlay", sessionId: null });
    return () => { sendToShell({ type: "composer-overlay", sessionId: null }); };
  }, [browserFullscreen, sessionId]);

  return browserFullscreen;
}
