// 归档页分组/筛选纯函数（settings/archivedGroups.ts）。
// 归档集合 ∩ workspace 会计槽的分组语义是本页的事实源，钉死边界：
// 无项目殿后、空组丢弃、会计槽顺序即组序、组内 updatedAt 降序。
import { describe, expect, it } from "vitest";
import { buildArchivedGroups, filterArchivedGroups, UNGROUPED } from "../settings/archivedGroups";
import type { SessionSummary, WorkspaceView } from "../types";

const ws = (id: string, title: string, sessionIds: string[]): WorkspaceView => ({
  workspaceId: id, path: `/x/${id}`, title, sessionIds, createdAt: "", updatedAt: "",
});
const s = (id: string, updatedAt: number): SessionSummary => ({
  sessionId: id, updatedAt, running: false, blank: false,
});
const titleOf = (x: SessionSummary) => x.sessionId;

describe("buildArchivedGroups", () => {
  it("按 workspace 顺序分组，组内 updatedAt 降序，无项目殿后", () => {
    const groups = buildArchivedGroups(
      [ws("w2", "voov", ["b1", "b2"]), ws("w1", "UI", ["a1"])],
      [s("a1", 3), s("b1", 9), s("b2", 5), s("z0", 1)],
      ["a1", "b1", "b2", "z0"],
      titleOf,
      "无项目",
    );
    expect(groups.map((g) => g.title)).toEqual(["voov", "UI", "无项目"]);
    expect(groups[0].rows.map((r) => r.sessionId)).toEqual(["b1", "b2"]);
    expect(groups[2].workspaceId).toBeNull();
  });

  it("未归档会话不入组；归档但不属于任何 workspace 的进无项目", () => {
    const groups = buildArchivedGroups(
      [ws("w1", "UI", ["a1", "live"])],
      [s("a1", 2), s("live", 9), s("solo", 1)],
      ["a1", "solo"],
      titleOf,
      "无项目",
    );
    expect(groups.map((g) => g.title)).toEqual(["UI", "无项目"]);
    expect(groups[0].rows.map((r) => r.sessionId)).toEqual(["a1"]);
  });

  it("无归档 → 空数组；workspace 零归档不产生空组", () => {
    expect(buildArchivedGroups([ws("w1", "UI", ["a1"])], [], [], titleOf, "无项目")).toEqual([]);
    expect(buildArchivedGroups([ws("w1", "UI", ["a1"])], [s("a1", 1)], [], titleOf, "无项目")).toEqual([]);
  });
});

describe("filterArchivedGroups", () => {
  const groups = buildArchivedGroups(
    [ws("w1", "UI", ["a1"]), ws("w2", "voov", ["b1"])],
    [s("a1", 2), s("b1", 1)],
    ["a1", "b1"],
    titleOf,
    "无项目",
  );

  it("搜索词大小写不敏感，命中行过滤、空组丢弃", () => {
    expect(filterArchivedGroups(groups, "A1", "").map((g) => g.title)).toEqual(["UI"]);
    expect(filterArchivedGroups(groups, "没有", "")).toEqual([]);
  });

  it("项目筛选：空值=全部，workspace id 命中单组，哨兵=无项目", () => {
    expect(filterArchivedGroups(groups, "", "").length).toBe(2);
    expect(filterArchivedGroups(groups, "", "w2").map((g) => g.title)).toEqual(["voov"]);
    const withStray = [...groups, { workspaceId: null, title: "无项目", rows: [{ sessionId: "z", title: "z", updatedAt: 0 }] }];
    expect(filterArchivedGroups(withStray, "", UNGROUPED).map((g) => g.title)).toEqual(["无项目"]);
  });

  it("搜索与项目筛选叠加", () => {
    expect(filterArchivedGroups(groups, "b1", "w1")).toEqual([]);
    expect(filterArchivedGroups(groups, "b1", "w2").map((g) => g.title)).toEqual(["voov"]);
  });
});
