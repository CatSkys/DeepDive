// 正文富输出的围栏词表与体积上限（唯一事实源）：Markdown 的块分流与三个块组件
// 共用同一份常量。上限挡住"把正文当文件塞"的巨型围栏——内联 SVG 与 srcdoc iframe
// 都是拿整串文本建 DOM/文档，超限退回代码块显示原文，宁可难看不可卡死界面。
export const MERMAID_FENCE = "mermaid";
export const SVG_FENCE = "svg";
export const WIDGET_FENCE = "widget";

/** 单个富输出围栏的字符上限（约 200KB）。 */
export const RICH_FENCE_MAX_CHARS = 200_000;
