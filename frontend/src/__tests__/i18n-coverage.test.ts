// EN 词典的两条机械卡点：源码里 `t("…")` 写的字面量源串必须都有英文，词典值不能是空的。
// 为什么需要它：i18n 的降级是**缺键回退中文源串**（i18n.ts 的既定设计）——写漏一条不报错、
// 测试不红、界面照常，只是那句话在英文界面里变成中文。2026-10-14 用户报的"设置页整页中文"
// 就是这么来的：划词与截图那一页 37 条从来没进过词典，谁也没发现。这类静默失效只能扫源码钉住。
// 口径：用 TypeScript 自己的 parser 走一遍 AST，只认**字面量**的 t()/tRaw() 入参——注释里的
// 示例、URL、模板插值都不误伤；**间接键**（t(变量)，如设置导航那张表）静态看不到，不在本门内。
// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { EN } from "../i18n-en";

const SRC = resolve(fileURLToPath(import.meta.url), "../..");

/** src 下的源文件（跳过词典自己与测试夹具——夹具里的 t() 是测试自己的桩）。 */
function sourceFiles(dir: string = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__" && entry.name !== "i18n-en") sourceFiles(path, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

/** 一处字面量键：源串 + 行号（报错要指得到人）。 */
type KeySite = { key: string; at: string };

/** 文件里所有字面量 t()/tRaw() 的入参（AST 走一遍：注释与字符串里的示例不算数）。 */
function literalKeySites(file: string): KeySite[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const sites: KeySite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && (node.expression.text === "t" || node.expression.text === "tRaw")) {
      const arg = node.arguments[0];
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
        const line = source.getLineAndCharacterOfPosition(arg.getStart(source)).line + 1;
        sites.push({ key: arg.text, at: `${relative(SRC, file)}:${line}` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

describe("EN 词典覆盖", () => {
  it("源码里 t()/tRaw() 写的字面量源串都在词典里", () => {
    const missing = sourceFiles()
      .flatMap(literalKeySites)
      .filter(({ key }) => !(key in EN))
      .map(({ key, at }) => `${at}  ${key}`);
    expect(missing, `这些源串没有英文（补进 frontend/src/i18n-en/ 对应域文件）：\n${missing.join("\n")}`)
      .toEqual([]);
  });

  it("没有空词条", () => {
    expect(Object.entries(EN).filter(([, en]) => en.trim() === "").map(([zh]) => zh)).toEqual([]);
  });
});
