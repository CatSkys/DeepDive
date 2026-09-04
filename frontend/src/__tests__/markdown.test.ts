// Markdown 渲染层的纯函数行为规格（R-001）：parseBlocks 块级切分 + inline
// 行内分支。inline 断言直接检查 React 元素结构（type/props），无需 DOM。
// 链接/图片分支的语义测试与修复（AUD-021）随后一并在源码层落地。
import { describe, expect, it } from "vitest";
import { inline, parseBlocks } from "../components/Markdown";

const noImage = () => { throw new Error("no image expected"); };

describe("parseBlocks 块级", () => {
  it("标题与段落分块", () => {
    expect(parseBlocks("# 标题\n\n正文一段")).toEqual([
      { kind: "h1", lines: ["标题"] },
      { kind: "p", lines: ["正文一段"] },
    ]);
    expect(parseBlocks("### 三级")[0]?.kind).toBe("h3");
  });

  it("围栏代码块带语言、内部结构不再解析", () => {
    expect(parseBlocks("```ts\nconst a = 1;\nif (x) {\n```\n")).toEqual([
      { kind: "code", lines: ["const a = 1;", "if (x) {"], lang: "ts" },
    ]);
  });

  it("引用/无序/有序列表与任务行（任务标记保留原文）", () => {
    expect(parseBlocks("> 引用行")[0]).toEqual({ kind: "quote", lines: ["引用行"] });
    expect(parseBlocks("- 甲\n- [x] 乙")).toEqual([{ kind: "ul", lines: ["甲", "[x] 乙"] }]);
    expect(parseBlocks("1. 甲\n2) 乙")[0]).toEqual({ kind: "ol", lines: ["甲", "乙"] });
  });

  it("表格：表头 + 分隔行被跳过 + 数据行", () => {
    const b = parseBlocks("| a | b |\n|---|---|\n| 1 | 2 |")[0];
    expect(b?.kind).toBe("table");
    expect(b?.lines[0]).toBe("a||b");
    // 分隔行不进数据行（曾混入渲染成短横线单元格）
    expect(b?.lines).toHaveLength(2);
    expect(b?.lines[1]).toBe("| 1 | 2 |");
  });

  it("块级数学跨行闭合（内容保留首尾换行，现状）", () => {
    const b = parseBlocks("$$\nx+1\n$$")[0];
    expect(b?.kind).toBe("math");
    expect(b?.lines[0]).toBe("\nx+1\n");
  });
});

describe("inline 行内（正确分支）", () => {
  it("粗体/行内码/斜体/删除线各归其位，普通文本原样保留", () => {
    const out = inline("**粗**文`码`*斜*~~删~~尾", "k", noImage);
    expect(out[0]).toMatchObject({ type: "strong", props: { children: "粗" } });
    expect(out[1]).toBe("文");
    expect(out[2]).toMatchObject({ type: "code", props: { children: "码" } });
    expect(out[3]).toMatchObject({ type: "em", props: { children: "斜" } });
    expect(out[4]).toMatchObject({ type: "del", props: { children: "删" } });
    expect(out[5]).toBe("尾");
  });

  it("行内数学渲染为 katex 容器", () => {
    const out = inline("$x^2$", "k", noImage);
    expect(out[0]).toMatchObject({ type: "span", props: { className: "md-math" } });
    expect(String((out[0] as { props: { dangerouslySetInnerHTML: { __html: string } } }).props.dangerouslySetInnerHTML.__html)).toContain("katex");
  });

  it("无行内语法的整行原样返回", () => {
    expect(inline("平平无奇", "k", noImage)).toEqual(["平平无奇"]);
  });
});

describe("inline 图片/链接（AUD-021 语义）", () => {
  it("图片：src 与 alt 各归其位，点击回调携带二者", () => {
    const seen: Array<{ src: string; alt: string }> = [];
    const out = inline("![截图](/img/a.png)", "k", (src, alt) => seen.push({ src, alt }));
    const img = out[0] as { type: string; props: { src: string; alt: string; onClick: () => void } };
    expect(img.type).toBe("img");
    expect(img.props.src).toBe("/img/a.png");
    expect(img.props.alt).toBe("截图");
    img.props.onClick();
    expect(seen).toEqual([{ src: "/img/a.png", alt: "截图" }]);
  });

  it("链接：前后文本与 label 全保留，href 正确（不再整段吞掉）", () => {
    const out = inline("见[文档](https://example.com/x)结尾", "k", noImage);
    expect(out[0]).toBe("见");
    expect(out[1]).toMatchObject({ type: "a", props: { href: "https://example.com/x", children: "文档" } });
    expect(out[2]).toBe("结尾");
  });

  it("链接与图片同现互不干扰", () => {
    const out = inline("![](i.png)与[l](u)", "k", noImage);
    expect(out[0]).toMatchObject({ type: "img", props: { src: "i.png", alt: "" } });
    expect(out[1]).toBe("与");
    expect(out[2]).toMatchObject({ type: "a", props: { href: "u", children: "l" } });
  });

  it("空 alt 图片 alt 为空串（不取数学组）", () => {
    const out = inline("![](only.png)", "k", noImage);
    expect(out[0]).toMatchObject({ type: "img", props: { src: "only.png", alt: "" } });
  });
});
