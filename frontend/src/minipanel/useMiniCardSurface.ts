// 命令中心卡的**原生玻璃面**取数口：卡片自己量自己的矩形/圆角/进出时长，推给壳。
// 壳把一块真 Liquid Glass（NSGlassEffectView，见 WindowGlassView 的 .card 档）垫在
// 这个 webview 之下、按这里报的矩形跟着走——同一个 webview 里的 CSS 玻璃永远只是近似，
// 而网页那侧因此**不再自己画背景/模糊/投影/圆角**（否则又盖住那块原生面）。
//
// 口径与 titlebar.ts 的 rect 表一致：CSS 视口坐标（getBoundingClientRect，y-down、
// 缩放前），换算归壳；推送做差分，外加 300ms 安全网（无过渡的重排只有节拍能兜住）。
// 卸载 = 收起：壳把那块玻璃藏掉（面板隐藏时壳自己也会藏一遍）。
import { useEffect, type RefObject } from "react";
import { sendRects } from "../host";
import { hasRectChannel } from "../platform";

const PUSH_INTERVAL_MS = 300;

/** 卡片根元素 → 原生玻璃面。纯浏览器（无壳桥）静默降级：卡片照常渲染，只是没有那块面。 */
export function useMiniCardSurface(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!hasRectChannel()) return;
    let lastSig = "";
    const push = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      // 时长按 token 读：壳那边用它跑淡入，两边分开算就会看出"一块东西分两次出现"
      const durationMs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dur-fast")) || 120;
      const payload = {
        type: "mini-cc-rect",
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        radius,
        durationMs,
      };
      const sig = JSON.stringify(payload);
      if (sig === lastSig) return;
      lastSig = sig;
      sendRects(payload);
    };
    push();
    const iv = setInterval(push, PUSH_INTERVAL_MS);
    window.addEventListener("resize", push);
    const ro = new ResizeObserver(push);
    if (ref.current) ro.observe(ref.current);
    return () => {
      clearInterval(iv);
      window.removeEventListener("resize", push);
      ro.disconnect();
      sendRects({ type: "mini-cc-rect", rect: null });
    };
  }, [ref]);
}
