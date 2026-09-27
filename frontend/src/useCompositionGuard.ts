import { useRef } from "react";

// 中文输入法组合态守卫：WKWebView 上"确认候选词"的回车有时在 compositionend
// 之后才派发，且 isComposing 已复位为 false——只查事件字段会把确认回车当成
// 发送。组合中记入 ref；compositionend 后 GRACE_MS 内的回车一律视为余波吞掉。
//
// GRACE_MS=10 对齐官方输入面的实测窗口（vendored ui-conversation keymap.ts：
// "Safari delivers the closing keydown AFTER compositionend … holds the guard
// for 10ms more (the old textarea's proven window)"）——余波 keydown 在
// compositionend 的同一事件串里落地，10ms 足够吃到；再宽（曾用 200ms）会把
// 快手"空格上屏后立刻回车发送"的那一击也吞掉，表现成"按了没反应、要再按一次"
//（2026-09-27 用户报告）。
//
// 吞掉的余波回车必须连浏览器默认行为一起拦（swallow 内 preventDefault）：余波
// 回车到达时输入法已经松手，放行默认就是往 textarea 插一个换行——只吞不拦时用户
// 按回车发送得到的正是"结尾多出一行、得删掉重发"。组合中的回车（isComposing）
// 不拦：那一击归输入法（候选词导航与确认），拦了会打断候选。
// keyCode 229 是部分引擎不开 isComposing 时的组合信号（官方同款兜底）。

const GRACE_MS = 10;

export function useCompositionGuard() {
  const composing = useRef(false);
  const endedAt = useRef(0);
  return {
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: () => { composing.current = false; endedAt.current = Date.now(); },
    /** keydown 守卫：组合中 / 刚结束的余波 → true（调用方直接 return）。 */
    swallow: (e: React.KeyboardEvent) => {
      if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return true;
      const aftermath =
        composing.current || (e.key === "Enter" && Date.now() - endedAt.current < GRACE_MS);
      if (aftermath && e.key === "Enter") e.preventDefault();
      return aftermath;
    },
  };
}
