// SVG 消毒。
//
// 围栏里的 SVG 是模型输出，内联进文档就等于把它的 DOM 加进 SPA，所以：
//   · 禁 script（可执行）、foreignObject（可塞任意 HTML）；
//   · **`<style>` 不剥掉**：模型手写的 SVG 几乎全靠 `<style>` 里的 class/变量配色，剥掉之后
//     形状全部回落到默认纯黑、标签字色也丢，图上只剩黑块（比不渲染更糟）。样式表的作用域归
//     渲染端——图整个进 shadow root，作者规则照原样在影子树里匹配（见 ScopedSvg）。
//   · `:root` 改写成 `svg`：影子树里 `:root` 指文档根、匹配不到任何元素，而生成的 SVG 常写
//     `:root{--c1:…}` 声明调色板——不改写变量取不到值，形状又变黑。落在 `svg` 上变量照样往
//     下继承，且改不到影子树的宿主。
//
// style 属性（元素自带的 fill/stroke）本来就保留——只作用于自身元素。
//
// 例外：mermaid 11 的形状默认把节点底色/描边以**行内 `!important`** 形式烘在 rect 上
//（经典 look 的浅蓝 `#e8eef7` + 蓝边 `#4a6fa5`），它们压过主题的类规则（`.node rect`
// 里的 fill/stroke），结果是图永远长成 mermaid 的浅色调色板——深色界面里白字压浅底，
// 完全读不了（2026-09-27 用户报"没跟着外观颜色自适应"）。故把行内样式里带
// `!important` 的颜色声明摘掉：配色交回主题（themeVariables 已按应用明暗合成，
// 见 mermaidRender.ts），其余声明（尺寸/变换/描边宽度）原样保留。

import DOMPurify from "dompurify";

/** 消毒：返回可安全放进影子树的 SVG 串；没有 `<svg>` 根（或全被剥掉）返回 null 由调用方回退。 */
export function sanitizeSvg(source: string): string | null {
  const clean = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject"],
  });
  if (!/<svg([^>]*)>/i.test(clean)) return null;
  return clean
    .replace(
      /<style([^>]*)>([\s\S]*?)<\/style>/gi,
      (_all, styleAttrs: string, css: string) => `<style${styleAttrs}>${scopedCss(css)}</style>`,
    )
    .replace(/ style="([^"]*)"/gi, (all, decls: string) => {
      const kept = decls
        .split(";")
        .filter((d) => d.trim() !== "" && !/^(fill|stroke|color)\s*:[^;]*!important$/i.test(d.trim()));
      return kept.length === decls.split(";").filter((d) => d.trim() !== "").length
        ? all
        : ` style="${kept.join(";")}"`;
    });
}

/** 摘掉 @import（外部样式表＝外发请求，在影子树里本来也无效）与 @charset，再把 `:root`
 *  改成 `svg`（调色板变量要落在 SVG 根上才取得到值）。 */
function scopedCss(css: string): string {
  return css
    .replace(/@import[^;]*;/gi, "")
    .replace(/@charset[^;]*;/gi, "")
    .replace(/:root\b/g, "svg");
}
