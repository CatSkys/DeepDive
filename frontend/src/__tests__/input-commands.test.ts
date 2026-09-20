// 输入纯函数钉子：@ 引用 grammar（atGrammar，官方语义）、整行斜杠命令裁决
//（commandLine，官方 ui-commands matchEnter 的最小移植）与草稿页命令兜底车道
//（builtinCommands 合成的目录——草稿页无 agent，引擎目录不可达）。
import { describe, expect, it } from "vitest";
import { activeAtToken, formatMention } from "../atGrammar";
import { adjudicateSlashLine } from "../commandLine";
import { DRAFT_COMMANDS } from "../components/composer/builtinCommands";
import type { CommandDescriptor } from "../types";

describe("activeAtToken", () => {
  it("行首与空白后触发", () => {
    expect(activeAtToken("@src", 4)).toMatchObject({ prefix: "@src", query: "src", quoted: false });
    expect(activeAtToken("look @src/ma", 13)).toMatchObject({ prefix: "@src/ma", query: "src/ma" });
  });

  it("邮箱内 @ 不触发；无 @ 不触发", () => {
    expect(activeAtToken("mail@a.com", 6)).toBeUndefined();
    expect(activeAtToken("plain text", 10)).toBeUndefined();
  });

  it('引号路径 @" 可含空格，保持引号开启态', () => {
    expect(activeAtToken('@"my file', 9)).toMatchObject({ prefix: '@"my file', query: "my file", quoted: true });
  });
});

describe("formatMention", () => {
  it("目录补尾斜杠；文件不加", () => {
    expect(formatMention({ path: "/w/src", kind: "directory" }, false)).toBe("@/w/src/");
    expect(formatMention({ path: "/w/a.ts", kind: "file" }, false)).toBe("@/w/a.ts");
  });

  it("含空格路径加引号；引号目录保持引号开启以便续层", () => {
    expect(formatMention({ path: "/w/my file", kind: "file" }, false)).toBe('@"/w/my file"');
    expect(formatMention({ path: "/w/my dir", kind: "directory" }, true)).toBe('@"/w/my dir/');
  });

  it("带控制字符/引号的路径拒绝表达", () => {
    expect(formatMention({ path: '/w/a"b', kind: "file" }, false)).toBeUndefined();
    expect(formatMention({ path: "/w/a\nb", kind: "file" }, false)).toBeUndefined();
  });
});

describe("adjudicateSlashLine", () => {
  const catalog: CommandDescriptor[] = [
    { name: "compact", description: "" },
    { name: "goal", description: "", input: { hint: "<objective>" } },
  ];

  it("已知命令整行命中（含参数与前后空白）", () => {
    expect(adjudicateSlashLine("/compact", catalog)).toEqual({ kind: "command", command: catalog[0], line: "/compact" });
    expect(adjudicateSlashLine("  /goal 修好登录页  ", catalog)).toEqual({ kind: "command", command: catalog[1], line: "/goal 修好登录页" });
  });

  it("未知名字 → unknown（拒绝提交，不喂模型）", () => {
    expect(adjudicateSlashLine("/nope args", catalog)).toEqual({ kind: "unknown", name: "nope" });
  });

  it("非整行命令 → null 回落 prompt：斜杠在文中、路径形、非斜杠开头", () => {
    expect(adjudicateSlashLine("看 /compact 这个", catalog)).toBeNull();
    expect(adjudicateSlashLine("/foo.ts", catalog)).toBeNull(); // 名字不合法（路径）
    expect(adjudicateSlashLine("普通消息", catalog)).toBeNull();
    expect(adjudicateSlashLine("", catalog)).toBeNull();
  });
});

describe("草稿页命令兜底车道", () => {
  it("列内建命令（含参数提示），/export 不入列", () => {
    const names = DRAFT_COMMANDS.map((c) => c.name);
    expect(names).toHaveLength(14);
    expect(names).not.toContain("export");
    expect(names).toContain("compact");
  });

  it("claim/直发分叉与引擎一致：有 input 才 claim 续输", () => {
    const input = (name: string) => DRAFT_COMMANDS.find((c) => c.name === name)?.input;
    expect(input("goal")).toEqual({ hint: "[<objective>|clear|edit <objective>|pause|resume]" });
    expect(input("permission")).toEqual({ hint: "<preset>" });
    expect(input("compact")).toBeUndefined();
  });

  it("整行裁决认得本车道（草稿页 Enter 与菜单同源）", () => {
    expect(adjudicateSlashLine("/compact", DRAFT_COMMANDS)).toMatchObject({ kind: "command", command: { name: "compact" } });
    expect(adjudicateSlashLine("/nope", DRAFT_COMMANDS)).toEqual({ kind: "unknown", name: "nope" });
  });
});
