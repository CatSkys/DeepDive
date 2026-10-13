// 面板里那两块**原生玻璃件**的矩形表：右上胶囊（.mini-controls）与输入框（.composer）。
// 壳按这份表把它们底下那两块系统玻璃（WindowGlassView 的 .floating 档）摆到位——网页那侧
// 这两个元素因此不再自己画底色/模糊/投影（见 theme.css 面板作用域）。
//
// 与 titlebar.ts / miniCardAnchor.ts 同一条纪律：CSS 视口坐标（y-down、缩放前）、做差分、
// 300ms 安全网兜住无过渡的重排（输入框会长高、胶囊随语言换宽）。空矩形 = 那件不在。
import { sendRects } from "../host";
import { hasRectChannel } from "../platform";

const PUSH_INTERVAL_MS = 300;

function piece(el: Element | null): { rect: Record<string, number>; radius: number } | null {
  if (!(el instanceof HTMLElement)) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, radius };
}

/** 面板页挂载时装一次：胶囊与输入框的矩形持续上报（卸载/换页自己重来）。 */
export function initMiniGlassBridge(): () => void {
  if (!hasRectChannel()) return () => {};
  let lastSig = "";
  const push = () => {
    const payload = {
      type: "mini-glass",
      capsule: piece(document.querySelector(".mini-controls")),
      composer: piece(document.querySelector(".composer")),
    };
    const sig = JSON.stringify(payload);
    if (sig === lastSig) return;
    lastSig = sig;
    sendRects(payload);
  };
  push();
  const iv = setInterval(push, PUSH_INTERVAL_MS);
  window.addEventListener("resize", push);
  return () => {
    clearInterval(iv);
    window.removeEventListener("resize", push);
    sendRects({ type: "mini-glass", capsule: null, composer: null });
  };
}
