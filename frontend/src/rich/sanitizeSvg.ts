// SVG 消毒：围栏里的 SVG 是模型输出，内联进文档就等于把它的 DOM 加进 SPA，所以只
// 放行 svg profile 的绘图面，并额外禁掉三个能越出"一张图"边界的标签——script（可执
// 行）、foreignObject（可塞任意 HTML）、style（文档级样式表，能改整个应用的排版）。
// style 属性保留：它只作用于自身元素，禁掉会让绝大多数真实 SVG 变形。
//
// mermaid 产物是唯一例外：它自带一个 id 作用域的 <style>，只做字体声明，所以那条路
// 径传 allowStyle（见 mermaidRender）。
import DOMPurify from "dompurify";

const BLOCKED = ["script", "foreignObject", "style"];

/** 消毒并确认输出里确实有 <svg> 根；没有根（或全被剥掉）返回 null 由调用方回退。 */
export function sanitizeSvg(source: string, opts?: { allowStyle?: boolean }): string | null {
  const clean = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: opts?.allowStyle ? BLOCKED.filter((tag) => tag !== "style") : BLOCKED,
  });
  return /<svg[\s>]/i.test(clean) ? clean : null;
}
