import { useRef } from "react";

// 中文输入法组合态守卫：WKWebView 上"确认候选词"的回车有时在 compositionend
// 之后才派发，且 isComposing 已复位为 false——只查事件字段会把确认回车当成
// 发送。组合中记入 ref；compositionend 后 GRACE_MS 内的回车一律视为余波吞掉
//（正常"确认后稍停再按回车发送"的间隔远大于此窗口）。

const GRACE_MS = 200;

export function useCompositionGuard() {
  const composing = useRef(false);
  const endedAt = useRef(0);
  return {
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: () => { composing.current = false; endedAt.current = Date.now(); },
    /** keydown 守卫：组合中 / 刚结束的余波 → true（调用方直接 return）。 */
    swallow: (e: React.KeyboardEvent) =>
      e.nativeEvent.isComposing ||
      composing.current ||
      (e.key === "Enter" && Date.now() - endedAt.current < GRACE_MS),
  };
}
