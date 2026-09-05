import { describe, expect, it } from "vitest";
import { capsuleCategory, nextScheduleRecord, todoStats } from "../components/capsuleModel";
import { narrowGitStatus } from "../host";
import type { ScheduleRecord } from "../types";

const schedule: ScheduleRecord = { id: "s1", kind: "after", prompt: "喝水", afterSeconds: 1800 };

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
