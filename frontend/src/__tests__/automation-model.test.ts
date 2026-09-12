// 自动化计划纯函数：下次触发时刻（本地日历，跨月/DST 用日历加法）、
// 形状校验与运行历史裁剪。全是纯函数，不碰引擎与 localStorage。
import { describe, expect, it } from "vitest";
import { describeSchedule, isSchedule, nextRunAt, reuseSessionId, utcOffsetLabel, weekdayLabel, type AutomationTask, type Schedule, type TaskRun } from "../automation/model";
import { RUNS_PER_TASK, trimRuns } from "../automation/storage";

/** 本地时间构造（测试不依赖机器时区）。 */
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const clock = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
};

describe("nextRunAt", () => {
  it("每小时：取下一个 :MM 整点", () => {
    expect(clock(nextRunAt({ kind: "hourly", minute: 30 }, at(2026, 9, 11, 8, 10)))).toBe("2026-9-11 8:30");
    expect(clock(nextRunAt({ kind: "hourly", minute: 30 }, at(2026, 9, 11, 8, 40)))).toBe("2026-9-11 9:30");
  });

  it("每天：今天没过就今天，过了就明天", () => {
    const s: Schedule = { kind: "daily", hour: 9, minute: 0 };
    expect(clock(nextRunAt(s, at(2026, 9, 11, 8, 0)))).toBe("2026-9-11 9:00");
    expect(clock(nextRunAt(s, at(2026, 9, 11, 10, 0)))).toBe("2026-9-12 9:00");
    // 严格大于：正好等于触发时刻时不重复触发，顺延到下一次
    expect(clock(nextRunAt(s, at(2026, 9, 11, 9, 0)))).toBe("2026-9-12 9:00");
  });

  it("每工作日：周五过点后跳到周一，周末不排", () => {
    const s: Schedule = { kind: "weekdays", hour: 9, minute: 0 };
    expect(clock(nextRunAt(s, at(2026, 9, 11, 10, 0)))).toBe("2026-9-14 9:00"); // 周五 → 周一
    expect(clock(nextRunAt(s, at(2026, 9, 12, 8, 0)))).toBe("2026-9-14 9:00"); // 周六
    expect(clock(nextRunAt(s, at(2026, 9, 13, 8, 0)))).toBe("2026-9-14 9:00"); // 周日
  });

  it("每周 / 每月：按星期与日号推进，月末缺号取该月最后一天", () => {
    expect(clock(nextRunAt({ kind: "weekly", weekday: 1, hour: 9, minute: 0 }, at(2026, 9, 11, 10, 0)))).toBe("2026-9-14 9:00");
    const monthly: Schedule = { kind: "monthly", day: 31, hour: 9, minute: 0 };
    expect(clock(nextRunAt(monthly, at(2026, 4, 15, 10, 0)))).toBe("2026-4-30 9:00"); // 四月没有 31 号
    expect(clock(nextRunAt(monthly, at(2026, 4, 30, 10, 0)))).toBe("2026-5-31 9:00");
  });

  it("自定义：按日历天步进", () => {
    const s: Schedule = { kind: "custom", everyDays: 3, hour: 9, minute: 0 };
    expect(clock(nextRunAt(s, at(2026, 9, 11, 8, 0)))).toBe("2026-9-11 9:00");
    expect(clock(nextRunAt(s, at(2026, 9, 11, 10, 0)))).toBe("2026-9-14 9:00");
  });
});

describe("describeSchedule / 标签", () => {
  it("给出前缀与时间两段（时间可高亮）", () => {
    expect(describeSchedule({ kind: "daily", hour: 5, minute: 0 })).toEqual({ prefix: "每天", time: "05:00" });
    expect(describeSchedule({ kind: "weekly", weekday: 5, hour: 16, minute: 0 })).toEqual({ prefix: "每周五", time: "16:00" });
    expect(describeSchedule({ kind: "custom", everyDays: 2, hour: 5, minute: 30 })).toEqual({ prefix: "每 2 天", time: "05:30" });
    expect(describeSchedule({ kind: "hourly", minute: 15 })).toEqual({ prefix: "每小时", time: ":15" });
    expect(weekdayLabel(0)).toBe("周日");
    expect(utcOffsetLabel(new Date(2026, 0, 1, 0, 0))).toMatch(/^GMT[+-]\d/);
  });
});

describe("isSchedule", () => {
  it("参数齐全且为有限数才算数", () => {
    expect(isSchedule({ kind: "daily", hour: 9, minute: 0 })).toBe(true);
    expect(isSchedule({ kind: "weekly", weekday: 3, hour: 9, minute: 0 })).toBe(true);
    expect(isSchedule({ kind: "daily", hour: 9 })).toBe(false);
    expect(isSchedule({ kind: "cron", expr: "* * * * *" })).toBe(false);
    expect(isSchedule(null)).toBe(false);
  });
});

describe("reuseSessionId", () => {
  const task = (target: "new" | "session", sessionId: string | null) =>
    ({ target, sessionId }) as AutomationTask;
  it("只有固定会话模式且那个会话还在引擎列表里才复用", () => {
    const known = new Set(["s1"]);
    expect(reuseSessionId(task("session", "s1"), known)).toBe("s1");
    expect(reuseSessionId(task("session", "gone"), known)).toBeNull(); // 被删了 → 下次运行重建
    expect(reuseSessionId(task("session", null), known)).toBeNull();   // 还没跑过
    expect(reuseSessionId(task("new", "s1"), known)).toBeNull();       // 新会话模式永不复用
  });
});

describe("trimRuns", () => {
  const run = (taskId: string, i: number): TaskRun => ({ id: `${taskId}-${i}`, taskId, sessionId: null, startedAt: i, status: "done" });
  it("每个任务只留最近 RUNS_PER_TASK 条", () => {
    const runs = [...Array(RUNS_PER_TASK + 5)].map((_, i) => run("a", i)).concat([run("b", 1)]);
    const kept = trimRuns(runs);
    expect(kept.filter((r) => r.taskId === "a")).toHaveLength(RUNS_PER_TASK);
    expect(kept.filter((r) => r.taskId === "b")).toHaveLength(1);
    expect(kept[0].startedAt).toBe(RUNS_PER_TASK + 4);
  });
});
