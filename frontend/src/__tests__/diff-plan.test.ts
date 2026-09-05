// diff 纯函数钉子：diff 摊平/收窄（diffModel）与 plan-review 收窄（planReview）。
import { describe, expect, it } from "vitest";
import { buildDiffRows, diffCopyText, narrowDiffs } from "../diffModel";
import { planReviewOf } from "../planReview";
import type { QuestionItem } from "../types";

describe("buildDiffRows", () => {
  it("新建文件（oldText=null）只有 add 行 + path 头", () => {
    const r = buildDiffRows([{ path: "/a.txt", oldText: null, newText: "hello\nworld" }]);
    expect(r.rows.map((x) => x.kind)).toEqual(["path", "add", "add"]);
    expect(r.added).toBe(2);
    expect(r.removed).toBe(0);
    expect(r.files).toBe(1);
  });

  it("编辑先 del 后 add；多文件用 ⋯ 间隔行分隔同文件第二段", () => {
    const r = buildDiffRows([
      { path: "/a.ts", oldText: "old\n", newText: "new\n" },
      { path: "/a.ts", oldText: "old2", newText: "new2" },
    ]);
    expect(r.rows.map((x) => x.kind)).toEqual(["path", "del", "add", "gap", "del", "add"]);
    expect(r.files).toBe(1);
  });

  it("结尾单个换行是终止符不产生空行；空串零行", () => {
    expect(buildDiffRows([{ path: "/a", oldText: "", newText: "x\n" }]).rows.map((x) => x.text)).toEqual(["/a", "x"]);
  });

  it("复制文本带 -/+ 前缀，path 头原样", () => {
    const rows = buildDiffRows([{ path: "/a", oldText: "o", newText: "n" }]).rows;
    expect(diffCopyText(rows)).toBe("/a\n- o\n+ n");
  });
});

describe("narrowDiffs", () => {
  it("良构 hunks 原样收窄；任一行畸形整列拒绝", () => {
    const good = [{ path: "/a", oldText: null, newText: "x" }];
    expect(narrowDiffs(good)).toEqual(good);
    expect(narrowDiffs([{ path: 1 }])).toBeNull();
    expect(narrowDiffs([{ path: "/a", oldText: 3, newText: "x" }])).toBeNull();
    expect(narrowDiffs([])).toBeNull();
    expect(narrowDiffs("nope")).toBeNull();
  });
});

describe("planReviewOf", () => {
  const base: QuestionItem = {
    id: "q1",
    question: "执行计划 A？",
    detail: "# Plan\n1. step",
    intent: { kind: "plan-review", approve: "Approve" },
    options: [{ label: "Approve" }, { label: "Decline" }],
  };

  it("单题 + detail + 二选项 → 收窄为决策卡", () => {
    const r = planReviewOf([base]);
    expect(r).toMatchObject({ id: "q1", approve: { label: "Approve" }, decline: { label: "Decline" } });
    expect(r?.plan).toContain("Plan");
  });

  it("无拒绝选项时 decline 缺省", () => {
    const r = planReviewOf([{ ...base, options: [{ label: "Approve", description: "go" }] }]);
    expect(r?.approve.description).toBe("go");
    expect(r?.decline).toBeUndefined();
  });

  it("多题/无 intent/无 detail/multiSelect/超二选项/缺 approve 标签 → 不接管", () => {
    expect(planReviewOf([base, base])).toBeUndefined();
    expect(planReviewOf([{ ...base, intent: undefined }])).toBeUndefined();
    expect(planReviewOf([{ ...base, detail: undefined }])).toBeUndefined();
    expect(planReviewOf([{ ...base, multiSelect: true }])).toBeUndefined();
    expect(planReviewOf([{ ...base, options: [...base.options!, { label: "C" }] }])).toBeUndefined();
    expect(planReviewOf([{ ...base, options: [{ label: "Yes" }] }])).toBeUndefined();
  });
});
