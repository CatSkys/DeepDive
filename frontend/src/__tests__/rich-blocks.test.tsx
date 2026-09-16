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

describe("mermaid 围栏", () => {
  it("不再当代码块，异步成图后进正文", async () => {
    const { container } = render(<Markdown text={"```mermaid\ngraph TD; A-->B;\n```"} />);
    expect(container.querySelector(".cb")).toBeNull();
    expect(container.querySelector(".md-rich-pending")).not.toBeNull();
    await waitFor(() => expect(container.querySelector(".md-rich-figure > svg")).not.toBeNull());
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
  it("消毒后内联：脚本 / 事件属性 / foreignObject / 文档级 style 全剥掉，图形留下", () => {
    const source = [
      '<svg viewBox="0 0 10 10">',
      "<script>alert(1)</script>",
      '<rect width="10" height="10" onload="alert(2)"/>',
      "<foreignObject><b>x</b></foreignObject>",
      "<style>body{display:none}</style>",
      '<circle r="2"/>',
      "</svg>",
    ].join("");
    const { container } = render(<Markdown text={"```svg\n" + source + "\n```"} />);
    const html = container.querySelector(".md-rich-figure")?.innerHTML ?? "";
    expect(container.querySelector("circle")).not.toBeNull();
    expect(html).not.toContain("script");
    expect(html).not.toContain("onload");
    expect(html).not.toContain("foreignObject");
    expect(html).not.toContain("<style");
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
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("24");
    expect(container.querySelector("svg")?.getAttribute("height")).toBe("24");
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
