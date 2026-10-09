import { describe, expect, it } from "vitest";
import {
  capsulePill, classifyJobs, nextScheduleRecord, sectionOpenOnCountChange, sectionOpenOnForceExpand,
  statusPanelHasContent, todoView,
  TODO_COMPACT_THRESHOLD, TODO_PENDING_WINDOW,
  type CapsuleGoal, type CapsuleTodo,
} from "../components/capsuleModel";
import { narrowGitStatus } from "../host";
import type { JobView, ScheduleRecord } from "../types";

const schedule: ScheduleRecord = { id: "s1", kind: "after", prompt: "喝水", afterSeconds: 1800 };
const t = (content: string, status: CapsuleTodo["status"]): CapsuleTodo => ({ content, status });
const goal = (phase: CapsuleGoal["phase"], objective = "把导出做好"): CapsuleGoal => ({
  id: "g1", revision: 1, objective, phase, maxGoalRounds: 3,
});
const git = { repo: true as const, files: 3, additions: 80, deletions: 26 };

/** 回落链的调用壳：默认全空，逐条用例只给要考的那一格。 */
const pill = (over: Partial<Parameters<typeof capsulePill>[0]> = {}) => capsulePill({
  todos: null, goal: null, git: null, runningCount: 0, endedCount: 0,
  scheduleRecords: [], fmtScheduleWhen: () => "30 分钟后",
  ...over,
});

describe("todoView：短表全列 / 长表聚焦窗", () => {
  it("短表（≤ 阈值）：未完成全列，已完成直接内联，不折叠", () => {
    const v = todoView([t("a", "completed"), t("b", "in_progress"), t("c", "pending"), t("d", "completed")]);
    expect(v.total).toBe(4);
    expect(v.done).toBe(2);
    expect(v.active?.content).toBe("b");
    expect(v.pending.map((x) => x.content)).toEqual(["c"]);
    expect(v.pendingHidden).toEqual([]);
    expect(v.completed.map((x) => x.content)).toEqual(["a", "d"]);
    expect(v.listCompleted).toBe(true);
  });

  it("正好等于阈值仍算短表", () => {
    const v = todoView(Array.from({ length: TODO_COMPACT_THRESHOLD }, (_, i) => t(`p${i}`, "pending")));
    expect(v.pending).toHaveLength(TODO_COMPACT_THRESHOLD);
    expect(v.pendingHidden).toEqual([]);
    expect(v.listCompleted).toBe(true);
  });

  it("长表：未完成只留前 N 项，其余进 pendingHidden，已完成交给折叠钮", () => {
    const long = [t("done1", "completed"), ...Array.from({ length: 6 }, (_, i) => t(`p${i}`, "pending"))];
    const v = todoView(long);
    expect(v.total).toBe(7);
    expect(v.pending.map((x) => x.content)).toEqual(["p0", "p1", "p2"].slice(0, TODO_PENDING_WINDOW));
    expect(v.pendingHidden.map((x) => x.content)).toEqual(["p3", "p4", "p5"]);
    expect(v.listCompleted).toBe(false);
    // 折叠只影响展示：项数守恒
    expect(v.pending.length + v.pendingHidden.length).toBe(6);
    expect(v.done).toBe(1);
  });

  it("空清单 / null：全零，不产生折叠", () => {
    for (const input of [null, undefined, []]) {
      expect(todoView(input)).toEqual({
        done: 0, total: 0, active: undefined, pending: [], pendingHidden: [], completed: [], listCompleted: true,
      });
    }
  });
});

describe("classifyJobs：在跑 / 已结束", () => {
  const job = (status: JobView["status"]): JobView => ({ id: status, kind: "bash", label: status, status, startedAt: 0 });
  it("running/stopping 归 live，其余归 ended", () => {
    const s = classifyJobs([job("running"), job("stopping"), job("completed"), job("killed"), job("failed")]);
    expect(s.live.map((j) => j.status)).toEqual(["running", "stopping"]);
    expect(s.ended.map((j) => j.status)).toEqual(["completed", "killed", "failed"]);
  });
  it("空输入两拨都空", () => {
    expect(classifyJobs([])).toEqual({ live: [], ended: [] });
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

describe("capsulePill 回落链（顺序与 ZCode StatusSummaryRow 一致）", () => {
  it("⓪ agent 正在操控浏览器：压过一切（含当前任务），带活信号", () => {
    expect(pill({ browser: { live: true, used: true, title: "示例页" }, todos: [t("在做", "in_progress")] }))
      .toEqual({ kind: "browser", title: "示例页", live: true });
    // 标题还没解析出来（空白标签/加载中）也要显示——那一级只给"浏览器"这个词
    expect(pill({ browser: { live: true, used: true, title: "" } }))
      .toEqual({ kind: "browser", title: "", live: true });
  });

  it("①′ agent 操控过浏览器：常驻在当前任务之下、目标/改动之上", () => {
    const browser = { live: false, used: true, title: "示例页" };
    // 当前任务仍然优先（那是最该动手的一件事）
    expect(pill({ browser, todos: [t("在做", "in_progress")] }))
      .toEqual({ kind: "todo", text: "在做", done: 0, total: 1 });
    // 没有当前任务时压过活动目标、改动、运行计数（浏览器只此一条入口，压太低等于没有）
    expect(pill({ browser, goal: goal("active") })).toEqual({ kind: "browser", title: "示例页", live: false });
    expect(pill({ browser, git, runningCount: 2 })).toEqual({ kind: "browser", title: "示例页", live: false });
  });

  it("没用过浏览器时这一级不存在（链的顺序与旧口径一致）", () => {
    expect(pill({ browser: { live: false, used: false, title: "" }, goal: goal("active") }))
      .toEqual({ kind: "goal", title: "把导出做好", done: false });
    expect(pill({ browser: { live: false, used: false, title: "" } })).toBeNull();
  });

  it("① 当前任务：进行中优先，其次第一条待办", () => {
    expect(pill({ todos: [t("写完了", "completed"), t("在做", "in_progress"), t("待办", "pending")] }))
      .toEqual({ kind: "todo", text: "在做", done: 1, total: 3 });
    // 只有待办也要显示——模型刚写完计划、还没开工时旧实现会整个空掉
    expect(pill({ todos: [t("待办", "pending")] })).toEqual({ kind: "todo", text: "待办", done: 0, total: 1 });
  });

  it("② 活动中的目标（active/paused/blocked 都算没完）", () => {
    for (const phase of ["active", "paused", "blocked"] as const) {
      expect(pill({ goal: goal(phase) })).toEqual({ kind: "goal", title: "把导出做好", done: false });
    }
  });

  it("③ 未提交改动排在已完成目标之前", () => {
    expect(pill({ goal: goal("complete"), git })).toEqual({ kind: "git", additions: 80, deletions: 26 });
  });

  it("④ 已完成的目标（与②同一个标题，分列两级）", () => {
    expect(pill({ goal: goal("complete") })).toEqual({ kind: "goal", title: "把导出做好", done: true });
  });

  it("⑤ 最后一条已完成的任务", () => {
    expect(pill({ todos: [t("甲", "completed"), t("乙", "completed")] })).toEqual({ kind: "todoDone", text: "乙" });
  });

  it("⑥ 运行中计数：live 活动只作兜底，压不过上面的各级", () => {
    expect(pill({ runningCount: 2 })).toEqual({ kind: "running", count: 2 });
    // 已完成的任务压过运行计数（ZCode 同款：todo 一完成，pill 就不再显示运行数）
    expect(pill({ todos: [t("刚完成", "completed")], runningCount: 2 })).toEqual({ kind: "todoDone", text: "刚完成" });
    // 运行计数压过兜底的提醒
    expect(pill({ runningCount: 1, scheduleRecords: [schedule] })).toEqual({ kind: "running", count: 1 });
  });

  it("⑦ 最近提醒：最低一级之前的兜底", () => {
    expect(pill({ scheduleRecords: [schedule] })).toEqual({ kind: "schedule", prompt: "喝水", when: "30 分钟后" });
  });

  it("⑧ 已结束计数（与 ZCode 的「已结束工作流」同级同位）", () => {
    expect(pill({ endedCount: 3 })).toEqual({ kind: "ended", count: 3 });
    expect(pill({ scheduleRecords: [schedule], endedCount: 3 })).toEqual({ kind: "schedule", prompt: "喝水", when: "30 分钟后" });
  });

  it("全空 → null（面板隐藏）", () => {
    expect(pill()).toBeNull();
    expect(pill({ todos: [], git: { repo: true, files: 0, additions: 0, deletions: 0 } })).toBeNull();
  });
});

describe("statusPanelHasContent：面板存亡的判据", () => {
  const base = { todos: null, goal: null, git: null, scheduleRecords: [], jobCount: 0, subagentEntryCount: 0, runningCount: 0 };
  it("任一区有料即为 true", () => {
    expect(statusPanelHasContent({ ...base, todos: [t("x", "pending")] })).toBe(true);
    expect(statusPanelHasContent({ ...base, goal: goal("complete") })).toBe(true);
    expect(statusPanelHasContent({ ...base, git })).toBe(true);
    expect(statusPanelHasContent({ ...base, scheduleRecords: [schedule] })).toBe(true);
    expect(statusPanelHasContent({ ...base, jobCount: 1 })).toBe(true);
    expect(statusPanelHasContent({ ...base, subagentEntryCount: 1 })).toBe(true);
    expect(statusPanelHasContent({ ...base, runningCount: 1 })).toBe(true);
  });
  it("全空为 false（面板隐藏）；git 零改动不算料", () => {
    expect(statusPanelHasContent(base)).toBe(false);
    expect(statusPanelHasContent({ ...base, git: { repo: true, files: 0, additions: 0, deletions: 0 } })).toBe(false);
  });
  it("有内容时链上必定给得出 pill（不会出现「有料却点不开」）", () => {
    const cases = [
      { ...base, todos: [t("只有待办", "pending")] },
      { ...base, goal: goal("complete") },
      { ...base, git },
      { ...base, scheduleRecords: [schedule] },
      { ...base, runningCount: 1 },
      { ...base, jobCount: 1, endedCount: 1 },
      { ...base, subagentEntryCount: 1, endedCount: 1 },
    ];
    for (const c of cases) {
      expect(statusPanelHasContent(c)).toBe(true);
      const got = capsulePill({ ...c, endedCount: (c as { endedCount?: number }).endedCount ?? 0, fmtScheduleWhen: () => "—" });
      expect(got).not.toBeNull();
    }
  });
});

describe("活动区开合的状态机（照 ZCode SessionPane 的 open 标记规则）", () => {
  // 另两条规则是宿主的：初值关、切会话回关（effect keyed on sessionId）——
  // 它们是"什么时候套用"，不是"套用什么"，ZCode 那边也没有对应用例。
  it("在跑数归零 → 自动收起，无论用户此前是否手动打开过", () => {
    expect(sectionOpenOnCountChange(true, 0)).toBe(false);
    expect(sectionOpenOnCountChange(false, 0)).toBe(false);
  });
  it("还有在跑的 → 保持当前开合（既不自作主张展开，也不收起）", () => {
    expect(sectionOpenOnCountChange(true, 2)).toBe(true);
    expect(sectionOpenOnCountChange(false, 2)).toBe(false);
  });
  it("强制展开（ZCode：点活动徽标）时按该区自身是否有料决定", () => {
    expect(sectionOpenOnForceExpand(3)).toBe(true);
    expect(sectionOpenOnForceExpand(0)).toBe(false);
  });
});
