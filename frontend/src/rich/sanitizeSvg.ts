// SVG 消毒 + 作用域限定。
//
// 围栏里的 SVG 是模型输出，内联进文档就等于把它的 DOM 加进 SPA，所以：
//   · 禁 script（可执行）、foreignObject（可塞任意 HTML）；
//   · **`<style>` 不剥掉，而是圈进这张图**——用 `@scope (#<svg-id>) { … }` 把作者的
//     样式表限定在 SVG 子树内。为什么不能剥：实测（2026-09-16）模型手写的 SVG 几乎全靠
//     `<style>` 里的 class/变量配色，剥掉之后形状全部回落到默认纯黑、标签字色也丢了，
//     图上只剩黑块（比不渲染更糟）。为什么不能原样留：文档级样式表能改整个应用的排版
//     （`* { display:none }` 那种）。@scope 两头都占：规则只在 SVG 里生效。
//   · `:root` 改写成 `:scope`：生成的 SVG 常写 `:root{--c1:…}` 声明调色板，而文档根不在
//     这个作用域里，不改写变量就取不到值（形状又变黑）。
//
// style 属性（元素自带的 fill/stroke）本来就保留——只作用于自身元素。

import DOMPurify from "dompurify";

let seq = 0;

/** 消毒：返回可安全内联的 SVG 串；没有 `<svg>` 根（或全被剥掉）返回 null 由调用方回退。 */
export function sanitizeSvg(source: string): string | null {
  const clean = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject"],
  });
  const root = /<svg([^>]*)>/i.exec(clean);
  if (!root) return null;
  const attrs = root[1]!;
  const styled = /<style[\s>]/i.test(clean);
  if (!styled) return clean;
  // 作者已经给了 id 就沿用（他的样式表可能正是 `#foo …` 那种写法），否则给一个
  const existing = /\sid\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
  const scopeId = existing && existing.trim() !== "" ? existing : `md-svg-${++seq}`;
  const scoped = existing && existing.trim() !== "" ? clean : clean.replace(/<svg/i, `<svg id="${scopeId}"`);
  return scoped.replace(
    /<style([^>]*)>([\s\S]*?)<\/style>/gi,
    (_all, styleAttrs: string, css: string) =>
      `<style${styleAttrs}>${scopedCss(css, scopeId)}</style>`,
  );
}

/** 把一段 SVG 自带的 CSS 圈进 `#scopeId`：先摘掉 @import（外部样式表＝外发请求，
 *  在作用域里本来也无效），再把 `:root` 换成 `:scope`（调色板变量要落在 SVG 根上）。 */
function scopedCss(css: string, scopeId: string): string {
  const cleaned = css
    .replace(/@import[^;]*;/gi, "")
    .replace(/@charset[^;]*;/gi, "")
    .replace(/:root\b/g, ":scope");
  return `@scope (#${scopeId}) {${cleaned}}`;
}
