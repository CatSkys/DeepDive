import { describe, expect, it } from "vitest";
import {
  EXPAND_STEP,
  contentLines,
  contextLines,
  foldGaps,
  parsePatch,
  untrackedLines,
  type DiffHunk,
} from "../review/patchModel";
import { narrowReviewChanges, narrowReviewDiff } from "../review/gitChangesModel";

// 审查面板的两层纯函数：wire 收窄 + unified diff 解析/折叠。

describe("parsePatch", () => {
  const patch = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 1111111..2222222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -17,3 +17,4 @@ function head() {",
    " keep",
    "-gone",
    "+fresh",
    "+more",
    " tail",
  ].join("\n");

  it("摊出 hunk 与行，行号槽按 add=新号 / ctx·del=旧号", () => {
    const out = parsePatch(patch);
    expect(out).not.toBeNull();
    expect(out?.hunks).toHaveLength(1);
    const lines = out!.hunks[0].lines;
    expect(lines.map((l) => [l.kind, l.number, l.text])).toEqual([
      ["ctx", 17, "keep"],
      ["del", 18, "gone"],
      ["add", 18, "fresh"],
      ["add", 19, "more"],
      ["ctx", 19, "tail"],
    ]);
  });

  it("记下 hunk 头的旧/新区间与路径", () => {
    const out = parsePatch(patch)!;
    expect(out.oldPath).toBe("src/a.ts");
    expect(out.newPath).toBe("src/a.ts");
    expect(out.hunks[0]).toMatchObject({ oldStart: 17, oldLines: 3, newStart: 17, newLines: 4 });
  });

  it("省略计数时按 1 行算（@@ -1 +1 @@）", () => {
    const out = parsePatch("@@ -1 +1 @@\n-a\n+b\n")!;
    expect(out.hunks[0]).toMatchObject({ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 });
  });

  it("新增文件：旧侧是 /dev/null", () => {
    const out = parsePatch(["--- /dev/null", "+++ b/new.ts", "@@ -0,0 +1,2 @@", "+a", "+b"].join("\n"))!;
    expect(out.oldPath).toBe("");
    expect(out.newPath).toBe("new.ts");
    expect(out.hunks[0].lines.map((l) => l.kind)).toEqual(["add", "add"]);
  });

  it("「\\ No newline at end of file」修饰上一行且不占行", () => {
    const out = parsePatch(["--- a/a.txt", "+++ b/a.txt", "@@ -1,1 +1,1 @@", "-old", "\\ No newline at end of file", "+new", "+tail"].join("\n"))!;
    const lines = out.hunks[0].lines;
    expect(lines).toHaveLength(3);
    expect(lines[0].noNewline).toBe(true);
    expect(lines[1].noNewline).toBe(false);
  });

  it("空上下文行（只有一个空格）行号照走", () => {
    const out = parsePatch(["--- a/a.ts", "+++ b/a.ts", "@@ -1,2 +1,2 @@", "-x", " ", "+y"].join("\n"))!;
    expect(out.hunks[0].lines[1]).toMatchObject({ kind: "ctx", text: "", number: 2 });
  });

  it("hunk 内被删的一行若内容以 -- 开头，不得当成文件头吞掉", () => {
    // 真 git 的输出：删掉内容为 "-- foo" 的行，patch 里渲染成 `--- foo`，
    // 与 `--- a/x` 头部逐字节相同。头部判定必须限定在第一个 @@ 之前。
    const out = parsePatch([
      "--- a/f.md", "+++ b/f.md", "@@ -1,2 +1 @@", "--- foo", " keep",
    ].join("\n"))!;
    expect(out.oldPath).toBe("f.md");
    expect(out.hunks[0].lines).toHaveLength(2);
    expect(out.hunks[0].lines[0]).toMatchObject({ kind: "del", text: "-- foo", number: 1 });
  });

  it("没有 @@ 就是无可展内容（只改模式等），返回 null", () => {
    expect(parsePatch("diff --git a/a b/a\nold mode 100644\nnew mode 100755\n")).toBeNull();
  });
});

describe("untrackedLines", () => {
  it("每行都是新增，行号从 1 连续", () => {
    const lines = untrackedLines("one\ntwo\nthree\n");
    expect(lines.map((l) => [l.kind, l.number, l.text])).toEqual([
      ["add", 1, "one"],
      ["add", 2, "two"],
      ["add", 3, "three"],
    ]);
  });

  it("结尾换行是终止符，不多出一空行", () => {
    expect(untrackedLines("a\n")).toHaveLength(1);
  });

  it("无结尾换行时末行标出来", () => {
    const lines = untrackedLines("a\nb");
    expect(lines[1].noNewline).toBe(true);
    expect(lines[0].noNewline).toBe(false);
  });

  it("空文件零行", () => {
    expect(untrackedLines("")).toEqual([]);
  });
});

describe("foldGaps", () => {
  const hunk = (oldStart: number, oldLines: number): DiffHunk => ({
    header: "", lines: [], oldStart, oldLines, newStart: oldStart, newLines: oldLines,
  });

  it("hunk 之间的未改动行 = 下一 hunk 旧侧起点 − 上一 hunk 旧侧终点", () => {
    // hunk0 覆盖旧 1..2，hunk1 从 20 起 → 空档 17 行
    const gaps = foldGaps([hunk(1, 2), hunk(20, 2)], {});
    // fromNew = 上一个 hunk 的新侧终点（1+2），展开时从这里切工作树全文
    expect(gaps).toEqual([{ afterHunk: 0, lines: 17, shown: 0, fromNew: 3 }]);
  });

  it("1 行上下文不折（阈值 1 = ≥2 才折）", () => {
    expect(foldGaps([hunk(1, 2), hunk(4, 2)], {})).toEqual([]);
  });

  it("相邻或重叠（空档 ≤0）不是折点", () => {
    expect(foldGaps([hunk(1, 5), hunk(5, 2)], {})).toEqual([]);
  });

  it("点一次展开 EXPAND_STEP，且不超过空档全长", () => {
    const hunks = [hunk(1, 2), hunk(202, 2)]; // 空档 199 行
    expect(foldGaps(hunks, { 0: EXPAND_STEP })[0].shown).toBe(100);
    expect(foldGaps(hunks, { 0: EXPAND_STEP })[0].fromNew).toBe(3);
    expect(foldGaps(hunks, { 0: 9999 })[0].shown).toBe(199);
  });

  it("单 hunk 没有折点", () => {
    expect(foldGaps([hunk(1, 2)], { 0: 500 })).toEqual([]);
  });
});

describe("narrowReviewChanges", () => {
  const ok = {
    repo: true,
    branch: "main",
    files: [{ path: "a.ts", originalPath: "", kind: "modified", added: 20, removed: 4, binary: false }],
  };

  it("良构载荷原样通过", () => {
    expect(narrowReviewChanges(ok)).toEqual(ok);
  });

  it("repo 非真 → 空表（没有 git 数据，不是错误）", () => {
    expect(narrowReviewChanges({ repo: false, files: [] })).toEqual({ repo: false, branch: "", files: [] });
    expect(narrowReviewChanges(null)).toEqual({ repo: false, branch: "", files: [] });
  });

  it("缺 path 或 kind 未知 → 整条丢弃，不给半个字段", () => {
    const out = narrowReviewChanges({
      repo: true, branch: "main",
      files: [{ path: "", kind: "modified" }, { path: "b.ts", kind: "???" }, ok.files[0]],
    });
    expect(out.files.map((f) => f.path)).toEqual(["a.ts"]);
  });

  it("计数与 binary 漂移按缺省落，不让 undefined 进 UI 运算", () => {
    const out = narrowReviewChanges({ repo: true, branch: "main", files: [{ path: "a.ts", kind: "added" }] });
    expect(out.files[0]).toEqual({ path: "a.ts", originalPath: "", kind: "added", added: 0, removed: 0, binary: false });
  });

  it("files 非数组 → 空表", () => {
    expect(narrowReviewChanges({ repo: true, files: "nope" }).files).toEqual([]);
  });
});

describe("narrowReviewDiff", () => {
  it("patch 档读 patch，untracked 档读 content，其余两档都不带正文", () => {
    expect(narrowReviewDiff({ kind: "patch", patch: "diff --git a/x b/x\n" })).toEqual({
      kind: "patch", patch: "diff --git a/x b/x\n", content: "",
    });
    expect(narrowReviewDiff({ kind: "untracked", content: "a\nb\n" })).toEqual({
      kind: "untracked", patch: "", content: "a\nb\n",
    });
    // 半截 patch 解析出来是错的，所以截断档绝不能把正文透出去
    expect(narrowReviewDiff({ kind: "truncated", patch: "@@ -1,1 +1,1 @@\n-x" })).toEqual({
      kind: "truncated", patch: "", content: "",
    });
  });

  it("kind 未知/缺载荷 → unavailable", () => {
    expect(narrowReviewDiff({ kind: "wat" }).kind).toBe("unavailable");
    expect(narrowReviewDiff(null).kind).toBe("unavailable");
  });
});

describe("contextLines", () => {
  const content = ["a", "b", "c", "d", "e"];

  it("从 fromNew 起取 shown 行，编号是新侧行号", () => {
    expect(contextLines(content, 2, 2).map((l) => [l.kind, l.number, l.text])).toEqual([
      ["ctx", 2, "b"],
      ["ctx", 3, "c"],
    ]);
  });

  it("全文比 patch 短时到头就停，不越界取 undefined", () => {
    expect(contextLines(content, 4, 10)).toHaveLength(2);
  });

  it("取不到正文（空全文）就是空：折条退化成不可点的标签", () => {
    expect(contextLines([], 3, 5)).toEqual([]);
  });
});

describe("contentLines", () => {
  it("结尾换行是终止符，不多出一空行", () => {
    expect(contentLines("a\nb\n")).toEqual(["a", "b"]);
    expect(contentLines("a\nb")).toEqual(["a", "b"]);
    expect(contentLines("")).toEqual([]);
  });
});
