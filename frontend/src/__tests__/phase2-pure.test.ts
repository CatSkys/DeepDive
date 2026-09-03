// 阶段 2 纯函数钉子：@ 引用 grammar（官方语义）与静态命令目录。
import { describe, expect, it } from "vitest";
import { activeAtToken, formatMention } from "../atGrammar";
import { SLASH_COMMANDS } from "../commands";

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

describe("SLASH_COMMANDS 目录", () => {
  it("与 docs/DSH-WIRE.md §4 五条命令一致且小写唯一", () => {
    expect(SLASH_COMMANDS.map((c) => c.name)).toEqual(["compact", "plan", "permission", "goal", "feedback"]);
  });
});
