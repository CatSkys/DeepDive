import { describe, expect, it } from "vitest";
import { capsuleCategory, nextScheduleRecord, todoStats, todoView, TODO_COMPACT_THRESHOLD, TODO_PENDING_WINDOW } from "../components/capsuleModel";
import type { CapsuleTodo } from "../components/capsuleModel";
import { narrowGitStatus } from "../host";
import type { ScheduleRecord } from "../types";

const schedule: ScheduleRecord = { id: "s1", kind: "after", prompt: "喝水", afterSeconds: 1800 };

const t = (content: string, status: CapsuleTodo["status"]): CapsuleTodo => ({ content, status });

describe("todoStats", () => {
  it("统计 done/total 并取第一个 in_progress", () => {
    const s = todoStats([
      { content: "a", status: "completed" },
      { content: "b", status: "in_progress" },
      { content: "c", status: "pending" },
    ]);
    expect(s).toEqual({ done: 1, total: 3, active: { content: "b", status: "in_progress" } });
  });
  it("null/undefined 视为空清单", () => {
    expect(todoStats(null)).toEqual({ done: 0, total: 0, active: undefined });
    expect(todoStats(undefined)).toEqual({ done: 0, total: 0, active: undefined });
  });
});

describe("todoView：短表全列 / 长表聚焦窗", () => {
  it("短表（≤ 阈值）：未完成全列，已完成直接内联，不折叠", () => {
    const list = [t("a", "completed"), t("b", "in_progress"), t("c", "pending"), t("d", "completed")];
    const v = todoView(list);
    expect(v.total).toBe(4);
    expect(v.done).toBe(2);
    expect(v.active?.content).toBe("b");
    expect(v.pending.map((x) => x.content)).toEqual(["c"]);
    expect(v.pendingHidden).toEqual([]);
    expect(v.completed.map((x) => x.content)).toEqual(["a", "d"]);
    expect(v.listCompleted).toBe(true);
  });

  it("正好等于阈值仍算短表", () => {
    const list = Array.from({ length: TODO_COMPACT_THRESHOLD }, (_, i) => t(`p${i}`, "pending"));
    const v = todoView(list);
    expect(v.pending).toHaveLength(TODO_COMPACT_THRESHOLD);
    expect(v.pendingHidden).toEqual([]);
    expect(v.listCompleted).toBe(true);
  });

  it("长表：未完成只留前 N 项，其余进 pendingHidden，已完成交给折叠钮", () => {
    const list = [
      t("done1", "completed"),
      ...Array.from({ length: 5 }, (_, i) => t(`p${i}`, "pending")),
    ];
    const v = todoView(list);
    expect(v.total).toBe(6); // 1 已完成 + 5 未完成 —— 恰好阈值，仍是短表
    expect(v.listCompleted).toBe(true);

    const long = [...list, t("p5", "pending")];
    const w = todoView(long);
    expect(w.total).toBe(7);
    expect(w.pending.map((x) => x.content)).toEqual(["p0", "p1", "p2"].slice(0, TODO_PENDING_WINDOW));
    expect(w.pendingHidden.map((x) => x.content)).toEqual(["p3", "p4", "p5"]);
    expect(w.listCompleted).toBe(false);
    // 折叠只影响展示：项数守恒
    expect(w.pending.length + w.pendingHidden.length).toBe(6);
    expect(w.done).toBe(1);
  });

  it("空清单 / null：全零，不产生折叠", () => {
    for (const input of [null, undefined, []]) {
      const v = todoView(input);
      expect(v).toEqual({ done: 0, total: 0, active: undefined, pending: [], pendingHidden: [], completed: [], listCompleted: true });
    }
  });
});

describe("narrowGitStatus", () => {
  it("仓库载荷通过并保留分支", () => {
    expect(narrowGitStatus({ repo: true, branch: "main", files: 3, additions: 80, deletions: 26 })).toEqual({
      repo: true, branch: "main", files: 3, additions: 80, deletions: 26,
    });
  });
  it("非仓库 / 缺数值字段 / null → null", () => {
    expect(narrowGitStatus({ repo: false })).toBeNull();
    expect(narrowGitStatus({ repo: true })).toBeNull();
    expect(narrowGitStatus(null)).toBeNull();
  });
});

describe("nextScheduleRecord", () => {
  it("取折叠序首条，空目录为 null", () => {
    expect(nextScheduleRecord([schedule])).toEqual(schedule);
    expect(nextScheduleRecord([])).toBeNull();
  });
});

describe("capsuleCategory 优先级", () => {
  const fmt = () => "30 分钟后";
  it("运行中智能体最高", () => {
    expect(capsuleCategory({
      agentsRunning: 2, todos: [{ content: "x", status: "in_progress" }],
      git: { repo: true, files: 1, additions: 1, deletions: 0 }, scheduleRecords: [schedule], fmtScheduleWhen: fmt,
    })).toEqual({ kind: "agents", count: 2 });
  });
  it("其次进行中任务", () => {
    expect(capsuleCategory({
      agentsRunning: 0, todos: [{ content: "x", status: "in_progress" }],
      git: { repo: true, files: 1, additions: 1, deletions: 0 }, scheduleRecords: [schedule], fmtScheduleWhen: fmt,
    })).toEqual({ kind: "todo", active: "x", done: 0, total: 1 });
  });
  it("再次未提交改动", () => {
    expect(capsuleCategory({
      agentsRunning: 0, todos: null, git: { repo: true, files: 4, additions: 80, deletions: 26 },
      scheduleRecords: [schedule], fmtScheduleWhen: fmt,
    })).toEqual({ kind: "git", additions: 80, deletions: 26 });
  });
  it("git 零改动不算数据", () => {
    expect(capsuleCategory({
      agentsRunning: 0, todos: null, git: { repo: true, files: 0, additions: 0, deletions: 0 },
      scheduleRecords: [schedule], fmtScheduleWhen: fmt,
    })).toEqual({ kind: "schedule", prompt: "喝水", when: "30 分钟后" });
  });
  it("全空 → null（胶囊隐藏）", () => {
    expect(capsuleCategory({ agentsRunning: 0, todos: null, git: null, scheduleRecords: [], fmtScheduleWhen: fmt })).toBeNull();
  });
});
