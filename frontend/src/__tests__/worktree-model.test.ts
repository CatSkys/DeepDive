// 工作树分区的纯逻辑规格：默认分支名/目录（目录必须落在仓库**同级**，否则工作树会被
// 自己的 git 状态扫到）、主工作树判据、分支标签回退。
import { describe, expect, it } from "vitest";
import { defaultBranchName, defaultWorktreePath, isMainWorktree, worktreeLabel } from "../worktree/model";

describe("defaultBranchName", () => {
  it("按本地时间生成 worktree-<yyyymmdd>-<hhmm>", () => {
    expect(defaultBranchName(new Date(2026, 8, 16, 21, 30))).toBe("worktree-20260916-2130");
    expect(defaultBranchName(new Date(2026, 0, 2, 3, 4))).toBe("worktree-20260102-0304");
  });
});

describe("defaultWorktreePath", () => {
  it("落在仓库同级目录，分支里的斜杠换成横线", () => {
    expect(defaultWorktreePath("/Users/me/proj", "feat/x")).toBe("/Users/me/proj-feat-x");
    expect(defaultWorktreePath("/Users/me/proj/", "worktree-20260916-2130")).toBe("/Users/me/proj-worktree-20260916-2130");
  });
});

describe("isMainWorktree", () => {
  it("路径就是仓库本身（忽略尾斜杠）", () => {
    expect(isMainWorktree({ path: "/Users/me/proj" }, "/Users/me/proj")).toBe(true);
    expect(isMainWorktree({ path: "/Users/me/proj/" }, "/Users/me/proj")).toBe(true);
    expect(isMainWorktree({ path: "/Users/me/proj-wt" }, "/Users/me/proj")).toBe(false);
  });
});

describe("worktreeLabel", () => {
  it("有分支给分支名；detached 给短提交 id", () => {
    expect(worktreeLabel({ branch: "main", detached: false, head: "86ae71d" })).toBe("main");
    expect(worktreeLabel({ branch: "", detached: true, head: "86ae71d" })).toBe("86ae71d");
    expect(worktreeLabel({ branch: "", detached: false, head: "86ae71d" })).toBe("—");
  });
});
