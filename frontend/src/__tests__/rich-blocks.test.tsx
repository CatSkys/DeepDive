// 富输出围栏（mermaid / svg / widget）的渲染与回退规格：围栏分流、SVG 消毒边界、
// 交互组件的沙箱属性、超限与失败退回代码块。mermaid 本体不在单测里跑（米级依赖、
// 要真浏览器），只钉"分流到 MermaidBlock"和"失败/超限时显示源码"。
// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { renderMermaid } = vi.hoisted(() => ({
  renderMermaid: vi.fn(async (code: string) => `<svg data-len="${code.length}"><rect width="1" height="1"/></svg>`),
}));
vi.mock("../rich/mermaidRender", () => ({ renderMermaid }));

import { Markdown } from "../components/Markdown";
import { RICH_FENCE_MAX_CHARS } from "../rich/fences";
import { sanitizeSvg } from "../rich/sanitizeSvg";
import { withNaturalSize } from "../rich/SvgBlock";

afterEach(() => {
  cleanup();
  renderMermaid.mockClear();
  renderMermaid.mockImplementation(async (code: string) => `<svg data-len="${code.length}"><rect width="1" height="1"/></svg>`);
  document.documentElement.removeAttribute("data-theme");
});

/** 图连带它的样式表都关在 .md-rich-figure 的影子树里（见 rich/ScopedSvg.tsx），
 *  查 svg / style 要先过 shadowRoot——这层隔离是规格的一部分，不是实现细节。 */
function figureOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(".md-rich-figure");
}
function shadowOf(container: HTMLElement): ShadowRoot | null {
  return figureOf(container)?.shadowRoot ?? null;
}

describe("mermaid 围栏", () => {
  it("不再当代码块，异步成图后进正文", async () => {
    const { container } = render(<Markdown text={"```mermaid\ngraph TD; A-->B;\n```"} />);
    expect(container.querySelector(".cb")).toBeNull();
    expect(container.querySelector(".md-rich-pending")).not.toBeNull();
    await waitFor(() => expect(shadowOf(container)?.querySelector("svg")).toBeTruthy());
    expect(renderMermaid).toHaveBeenCalledWith("graph TD; A-->B;", true);
  });

  it("亮色主题把明暗传给渲染（配色烘进产物，靠重渲换新）", async () => {
    document.documentElement.dataset.theme = "light";
    render(<Markdown text={"```mermaid\ngraph TD; A-->B;\n```"} />);
    await waitFor(() => expect(renderMermaid).toHaveBeenCalledWith("graph TD; A-->B;", false));
  });

  it("挂载后切主题会重渲染图示（不赌父组件会不会重渲，PITFALLS §8.6）", async () => {
    render(<Markdown text={"```mermaid\ngraph TD; A-->B;\n```"} />);
    await waitFor(() => expect(renderMermaid).toHaveBeenLastCalledWith("graph TD; A-->B;", true));
    document.documentElement.dataset.theme = "light";
    await waitFor(() => expect(renderMermaid).toHaveBeenLastCalledWith("graph TD; A-->B;", false));
  });

  it("渲染失败退回代码块并说明原因（不吞掉源码）", async () => {
    renderMermaid.mockRejectedValueOnce(new Error("parse error"));
    const { container } = render(<Markdown text={"```mermaid\nflowchart ???\n```"} />);
    await waitFor(() => expect(container.querySelector(".md-rich-note")).not.toBeNull());
    expect(container.querySelector(".md-rich-note")?.textContent).toContain("图表渲染失败");
    expect(container.querySelector(".cb")).not.toBeNull();
  });
});

describe("内联 SVG 围栏", () => {
  it("消毒后进影子树：脚本 / 事件属性 / foreignObject 剥掉，图形留下", () => {
    const source = [
      '<svg viewBox="0 0 10 10">',
      "<script>alert(1)</script>",
      '<rect width="10" height="10" onload="alert(2)"/>',
      "<foreignObject><b>x</b></foreignObject>",
      '<circle r="2"/>',
      "</svg>",
    ].join("");
    const { container } = render(<Markdown text={"```svg\n" + source + "\n```"} />);
    const shadow = shadowOf(container);
    const html = shadow?.innerHTML ?? "";
    expect(shadow?.querySelector("circle")).toBeTruthy();
    expect(html).not.toContain("script");
    expect(html).not.toContain("onload");
    expect(html).not.toContain("foreignObject");
    // 影子树之外的文档里不该留下图的任何节点（应用样式表才碰不到它）
    expect(container.querySelector("svg")).toBeNull();
  });

  it("作者样式表原样进影子树：`#id` 打头的选择器不能被改写（改写/包 @scope 都会全变黑）", () => {
    const source = [
      '<svg id="mine" viewBox="0 0 10 10">',
      "<style>:root{--c:#2E7FE0} #mine .node rect{fill:var(--c)} body{display:none}</style>",
      '<rect class="node" width="10" height="10"/>',
      "</svg>",
    ].join("");
    const { container } = render(<Markdown text={"```svg\n" + source + "\n```"} />);
    const shadow = shadowOf(container);
    const authorStyle = shadow?.querySelector("svg style")?.textContent ?? "";
    // 模型手写与 mermaid 产物都靠 `#<svg-id> …` 这种选择器配色，一字不改才配得上画面；
    // `:root` 指文档根、在影子树里匹配不到任何元素，落脚点改成 svg 自己
    expect(authorStyle).toContain("#mine .node rect{fill:var(--c)}");
    expect(authorStyle).toContain("svg{--c:#2E7FE0}");
    expect(authorStyle).not.toContain(":root");
    expect(authorStyle).not.toContain("@scope");
    expect(shadow?.querySelector("rect.node")).toBeTruthy();
    // 尺寸规则（max-width:100% 等）跨不进影子树，得随图一起进去（影子树里第一条 style）
    expect(shadow?.querySelector("style")?.textContent).toContain("max-width:100%");
    expect(sanitizeSvg(source)).toContain("#mine .node rect{fill:var(--c)}");
  });

  it("没有 <svg> 根就退回代码块", () => {
    const { container } = render(<Markdown text={"```svg\n<div>不是图</div>\n```"} />);
    expect(container.querySelector(".md-rich-figure")).toBeNull();
    expect(container.querySelector(".cb")).not.toBeNull();
    expect(container.querySelector(".md-rich-note")?.textContent).toContain("SVG 渲染失败");
  });

  it("sanitizeSvg 直接判定：非 SVG 一律 null", () => {
    expect(sanitizeSvg("<div>hi</div>")).toBeNull();
    expect(sanitizeSvg('<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>')).toContain("viewBox");
  });
});

describe("交互组件围栏", () => {
  it("进 sandbox iframe 真跑：只给 allow-scripts，不给 same-origin", () => {
    const { container } = render(<Markdown text={'```widget\n<button id="b">hi</button>\n```'} />);
    const frame = container.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("srcdoc")).toContain('<button id="b">');
    expect(frame?.getAttribute("title")).toBe("交互组件");
  });
});

describe("内联 SVG 尺寸", () => {
  it("只有 viewBox 时补自然尺寸（否则被 CSS 默认 width:100% 拉满整张卡）", () => {
    expect(withNaturalSize('<svg viewBox="0 0 120 40"><rect/></svg>')).toContain('<svg width="120" height="40"');
  });

  it("作者写了尺寸就原样不动", () => {
    const svg = '<svg width="10" height="20" viewBox="0 0 10 20"></svg>';
    expect(withNaturalSize(svg)).toBe(svg);
  });

  it("渲染路径上确实补上了尺寸", () => {
    const { container } = render(<Markdown text={'```svg\n<svg viewBox="0 0 24 24"><circle r="4"/></svg>\n```'} />);
    const svg = shadowOf(container)?.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("24");
    expect(svg?.getAttribute("height")).toBe("24");
  });
});

describe("围栏没写完时不报错（流式噪音）", () => {
  it("未闭合的 svg 围栏显示「正在读取」，而不是「SVG 渲染失败」", () => {
    const { container } = render(<Markdown text={"```svg\n<svg viewBox=\"0 0 10 10\">\n  <rect width=\"10\""} />);
    expect(container.textContent).toContain("正在读取图形");
    expect(container.textContent).not.toContain("SVG 渲染失败");
    expect(container.querySelector(".cb")).toBeNull();
  });

  it("未闭合的 mermaid 围栏同样只是「正在渲染」，且不去调用渲染", async () => {
    const { container } = render(<Markdown text={"```mermaid\ngraph TD; A-->B"} />);
    await new Promise((r) => setTimeout(r, 400));
    expect(container.textContent).toContain("正在渲染图表");
    expect(container.textContent).not.toContain("图表渲染失败");
    expect(renderMermaid).not.toHaveBeenCalled();
  });

  it("未闭合的 widget 围栏不挂 iframe（半截 HTML 不跑）", () => {
    const { container } = render(<Markdown text={"```widget\n<button>点我"} />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("正在读取组件");
  });

  it("闭合但确实坏的 svg 仍然报失败（别把真错误藏起来）", () => {
    const { container } = render(<Markdown text={"```svg\n<div>不是图</div>\n```"} />);
    expect(container.textContent).toContain("SVG 渲染失败");
  });
});

describe("围栏词表与上限", () => {
  it("超限围栏退回代码块（不建巨型 DOM）", () => {
    const big = "x".repeat(RICH_FENCE_MAX_CHARS + 1);
    const { container } = render(<Markdown text={"```svg\n" + big + "\n```"} />);
    expect(container.querySelector(".md-rich-figure")).toBeNull();
    expect(container.querySelector(".md-rich-note")?.textContent).toContain("内容过大");
  });

  it("其它语言照旧走代码块（不误伤）", () => {
    const { container } = render(<Markdown text={"```ts\nconst a = 1;\n```"} />);
    expect(container.querySelector(".cb")).not.toBeNull();
    expect(container.querySelector(".md-rich-figure")).toBeNull();
  });
});
