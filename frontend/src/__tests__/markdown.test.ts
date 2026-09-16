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
    expect(img.props.src).toBe("/api/file?path=%2Fimg%2Fa.png"); // 0.1.5：单斜杠开头本地路径重写 /api/file
    expect(img.props.alt).toBe("截图");
    img.props.onClick();
    expect(seen).toEqual([{ src: "/api/file?path=%2Fimg%2Fa.png", alt: "截图" }]);
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

  it("裸 URL 自动成链（模型常直出链接，不是 [label](url)）", () => {
    const out = inline("文档在 https://y0541zlfybv.feishu.cn/docx/YdZ1dmL9 这里", "k", noImage);
    expect(out[0]).toBe("文档在 ");
    expect(out[1]).toMatchObject({ type: "a", props: { href: "https://y0541zlfybv.feishu.cn/docx/YdZ1dmL9", children: "https://y0541zlfybv.feishu.cn/docx/YdZ1dmL9" } });
    expect(out[2]).toBe(" 这里");
  });

  it("加粗包住的 URL 也是链接（用户现场就是 **https://…**）", () => {
    const out = inline("**https://e.cn/x?y=1&z=2**", "k", noImage);
    const strong = out[0] as { type: string; props: { children: unknown[] } };
    expect(strong.type).toBe("strong");
    expect(strong.props.children[0]).toMatchObject({ type: "a", props: { href: "https://e.cn/x?y=1&z=2" } });
  });

  it("中文句末标点与裸右括号不进地址", () => {
    const out = inline("见（https://e.cn/a）。", "k", noImage);
    expect(out[1]).toMatchObject({ type: "a", props: { href: "https://e.cn/a" } });
    expect(out[2]).toBe("）。");
  });
});

describe("parseBlocks 终止性（2026-09-16 卡死事故回归）", () => {
  // 事故：流式正文改走 markdown 后，模型刚打出 "- " / "$$" 而内容或闭合还没到的那一瞬，
  // parseBlocks 出现零前进行——列表分支在 trim 后不认 "- "（要求标记后必须跟内容），
  // 段落分支却在原始行上认它，于是 i 不动、主线程空转，界面卡死（WebView 84% CPU、
  // RSS 2.4GB）。下面每条都是当时实测会自锁的输入。
  const LOCKED = [
    "- \n内容", "* \n内容", "- a\n- \n内容", "-  ", "*   ",
    "1. \n内容", "1) \n内容", "1. a\n2. \n内容",
    "$$", "$$$", "$$ x", "\n$$", "$$ 未闭合\n第二行",
  ];

  it("曾自锁的输入全部正常返回（不空转）", () => {
    const t0 = performance.now();
    for (const input of LOCKED) {
      const blocks = parseBlocks(input);
      expect(blocks.length).toBeGreaterThan(0);
      // 零前进的典型产物是空段落；这里不存在零行块
      for (const b of blocks) expect(b.lines.length).toBeGreaterThan(0);
    }
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it("流式瞬态渲染成正确形态：列表标记先出现、内容随后填进来", () => {
    expect(parseBlocks("- ")).toEqual([{ kind: "ul", lines: [""] }]);
    expect(parseBlocks("- \n内容")).toEqual([{ kind: "ul", lines: [""] }, { kind: "p", lines: ["内容"] }]);
    expect(parseBlocks("1. \n内容")).toEqual([{ kind: "ol", lines: [""] }, { kind: "p", lines: ["内容"] }]);
    expect(parseBlocks("- [ ] ")).toEqual([{ kind: "ul", lines: ["[ ]"] }]);
  });

  it("未闭合的 $$ 按字面段落渲染，闭合后才是公式", () => {
    expect(parseBlocks("$$ 未闭合\n第二行")).toEqual([{ kind: "p", lines: ["$$ 未闭合", "第二行"] }]);
    expect(parseBlocks("$$ x^2 $$")).toEqual([{ kind: "math", lines: [" x^2 "] }]);
    expect(parseBlocks("$$\n a+b \n$$")).toEqual([{ kind: "math", lines: ["\n a+b \n"] }]);
  });

  it("既有结构不受影响（标题/引用/表格/围栏/列表）", () => {
    expect(parseBlocks("# 标题").map((b) => b.kind)).toEqual(["h1"]);
    expect(parseBlocks("> 引用").map((b) => b.kind)).toEqual(["quote"]);
    expect(parseBlocks("| a | b |\n| --- | --- |\n| 1 | 2 |").map((b) => b.kind)).toEqual(["table"]);
    expect(parseBlocks("```ts\nconst a = 1;\n```").map((b) => b.kind)).toEqual(["code"]);
    expect(parseBlocks("- a\n- b").map((b) => b.lines)).toEqual([["a", "b"]]);
    expect(parseBlocks("1) a\n2) b").map((b) => b.kind)).toEqual(["ol"]);
    expect(parseBlocks("普通一段\n继续一行").map((b) => b.lines)).toEqual([["普通一段", "继续一行"]]);
  });

  it("逐字符前缀（模拟流式打字）逐帧可解析且不空转", () => {
    // 流式期间每一帧都会把「打了一半」的文本喂进来：列表标记单独一行、$$ 只打了一半、
    // 围栏只有开头三个反引号…… 字符级前缀能覆盖全部这些瞬态。曾在这里空转卡死。
    const doc = "# 标题\n\n结论：**可以**。\n\n- 第一项\n- 第二项\n\n```ts\nconst a = 1;\n```\n\n$$\nx^2\n$$\n\n尾部";
    const t0 = performance.now();
    let frames = 0;
    for (let n = 1; n <= doc.length; n++) {
      const blocks = parseBlocks(doc.slice(0, n));
      frames++;
      for (const b of blocks) {
        // 代码块允许空体（围栏刚打出来、正文还没到，是合法瞬态）；其余块零行即零前进
        if (b.kind !== "code") expect(b.lines.length).toBeGreaterThan(0);
      }
    }
    expect(frames).toBe(doc.length);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
