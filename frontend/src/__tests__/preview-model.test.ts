// 预览模型纯函数：扩展名 → 候选渲染器 / 高亮语言 / 换行能力，以及 Markdown
// 本地文件链接的解析（跳行入口）。语义对齐官方 ui-sidebar-documentpreview 的
// 渲染器注册表：多命中可切换、纯文本恒兜底。
import { describe, expect, it } from "vitest";
import { languageOf, renderersOf, supportsWrap, titleOf } from "../components/preview/previewModel";
import { localFileTarget } from "../components/Markdown";

describe("renderersOf", () => {
  it("按扩展名给候选，纯文本恒兜底", () => {
    expect(renderersOf("/w/a.md")).toEqual(["markdown", "code", "text"]);
    expect(renderersOf("/w/a.html")).toEqual(["html", "code", "text"]);
    expect(renderersOf("/w/a.png")).toEqual(["image", "text"]);
    expect(renderersOf("/w/a.pdf")).toEqual(["pdf", "text"]);
    expect(renderersOf("/w/a.ts")).toEqual(["code", "text"]);
    expect(renderersOf("/w/Makefile")).toEqual(["text"]);
  });
});

describe("languageOf", () => {
  it("只给本仓 highlight.js 认识的语言 id，认不出回空串（不猜）", () => {
    expect(languageOf("/w/a.ts")).toBe("typescript");
    expect(languageOf("/w/a.html")).toBe("xml");
    expect(languageOf("/w/a.sh")).toBe("bash");
    expect(languageOf("/w/a.md")).toBe("markdown");
    expect(languageOf("/w/a.txt")).toBe("");
    expect(languageOf("/w/Makefile")).toBe("");
  });
});

describe("supportsWrap / titleOf", () => {
  it("只有 code 与 text 声明换行", () => {
    expect(supportsWrap("code")).toBe(true);
    expect(supportsWrap("text")).toBe(true);
    expect(supportsWrap("markdown")).toBe(false);
    expect(supportsWrap("image")).toBe(false);
  });

  it("渲染器名走词典中文源串", () => {
    expect(titleOf("code")).toBe("代码");
    expect(titleOf("text")).toBe("纯文本");
  });
});

describe("localFileTarget（Markdown → 预览的跳行入口）", () => {
  it("相对/绝对路径都认，尾随 :行号 解析为行", () => {
    expect(localFileTarget("src/app.ts")).toEqual({ path: "src/app.ts" });
    expect(localFileTarget("src/app.ts:42")).toEqual({ path: "src/app.ts", line: 42 });
    expect(localFileTarget("/Users/x/a.md")).toEqual({ path: "/Users/x/a.md" });
    expect(localFileTarget("/Users/x/a.md:7")).toEqual({ path: "/Users/x/a.md", line: 7 });
  });

  it("外链/锚点/纯词/非法行号不认（保持原外链行为）", () => {
    expect(localFileTarget("https://x.dev/a.ts")).toBeNull();
    expect(localFileTarget("mailto:a@b.c")).toBeNull();
    expect(localFileTarget("//cdn/x.js")).toBeNull();
    expect(localFileTarget("#section")).toBeNull();
    expect(localFileTarget("README")).toBeNull();
    expect(localFileTarget("src/app.ts:0")).toEqual({ path: "src/app.ts" });
  });
});
