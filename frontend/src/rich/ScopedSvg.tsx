// 围栏成品图（mermaid / 手写 SVG）的落点：图连它自带的样式表一起放进 shadow root。
//
// 为什么是影子树：模型与 mermaid 生成的样式表几乎都是 `#<svg-id> .node rect {…}` 这种"以图
// 自己的 id 打头"的选择器，而 `@scope (#id)` 给每个选择器加的是隐式 `:scope ` **后代**前缀——
// 指名作用域根自身的那条永远匹配不上（根不是自己的后代），于是整片规则失效、形状回落成默认
// 纯黑（PITFALLS §3.8）。影子树按 CSS 作用域隔离：作者样式原样生效，又天然改不到应用排版
// （`*{display:none}` 只能命中影子树内的元素）。
import { useLayoutEffect, useRef } from "react";

/** 影子树里唯一属于我们的样式：尺寸归 SVG 自己的 viewBox，这里只压住不越界。 */
const SIZING_CSS = ":host{display:block}svg{display:block;max-width:100%;height:auto;margin:0 auto}";

export function ScopedSvg({ svg }: { svg: string }) {
  const host = useRef<HTMLDivElement>(null);
  // 画在首次绘制前就位：否则先空框、再撑开成图的高度，看到一次跳变
  useLayoutEffect(() => {
    const el = host.current;
    if (el === null) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${SIZING_CSS}</style>${svg}`;
  }, [svg]);
  return <div className="md-rich-figure" ref={host} />;
}
