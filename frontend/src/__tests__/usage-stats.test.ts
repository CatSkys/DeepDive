// 使用统计纯函数钉子：事件折叠（tokens/轮次/聊天时长）、连续天数、
// 取值格式化、模型排序与图表几何。数据形状对照 rc.2 持久事件实测
//（assistant/message.usage + message.source.model，time=epoch ms）。
import { describe, expect, it } from "vitest";
import {
  addDays, dayKeyOf, foldSessionEvents, formatDays, formatDuration, formatTokensShort,
  lastNDayKeys, makeUsageFold, modelOrderOf, statsFromFold,
} from "../stats/usageStats";
import { arcPath, smoothPath } from "../stats/chartMath";
import type { SessionEvent } from "../types";

// 固定"今天"=2026-09-04（本地时区正午，避开日期边界）
const NOW = new Date(2026, 8, 4, 12).getTime();
const DAY = (m: number, d: number, h = 12) => new Date(2026, m - 1, d, h).getTime();

let seq = 0;
/** union 尾部 catch-all 成员：持久事件信封（type/seq/time/data）的最窄构造。 */
const ev = (type: string, time: number, data: unknown): SessionEvent => ({ type, seq: seq++, time, data });

const assistantMsg = (time: number, model: string, input: number, output: number) =>
  ev("assistant/message", time, {
    turn: 1, step: 1,
    message: { role: "assistant", content: [], source: { kind: "model", provider: "prov", model }, id: "a" },
    usage: { inputTokens: input, outputTokens: output },
  });

describe("foldSessionEvents", () => {
  it("assistant/message 的 usage 按日/按模型累计（input+output）", () => {
    const fold = makeUsageFold();
    foldSessionEvents(fold, [
      assistantMsg(DAY(9, 2, 10), "glm-5.3-flash", 1000, 200),
      assistantMsg(DAY(9, 2, 11), "glm-5.3", 500, 100),
      assistantMsg(DAY(9, 3, 9), "glm-5.3-flash", 10, 20),
    ]);
    const stats = statsFromFold(fold, NOW);
    expect(stats.totalTokens).toBe(1830);
    const d2 = stats.days.find((x) => x.day === "2026-09-02")!;
    expect(d2.tokens).toBe(1800);
    expect(d2.byModel).toEqual({ "glm-5.3-flash": 1200, "glm-5.3": 600 });
  });

  it("轮次只认 source.kind=user 的 user/message", () => {
    const fold = makeUsageFold();
    foldSessionEvents(fold, [
      ev("user/message", DAY(9, 1, 9), { content: [], role: "user", source: { kind: "user" }, id: "u1" }),
      ev("user/message", DAY(9, 1, 10), { content: [], role: "user", source: { kind: "skill-catalog" }, id: "u2" }),
      assistantMsg(DAY(9, 1, 11), "m", 1, 1),
    ]);
    expect(statsFromFold(fold, NOW).days[0]!.turns).toBe(1);
  });

  it("聊天时长 = step/start→assistant/message + tool 配对；未配对的 call 不计", () => {
    const fold = makeUsageFold();
    foldSessionEvents(fold, [
      ev("step/start", DAY(9, 1, 9, ), { turn: 1, step: 1 }),
      ev("tool/call", DAY(9, 1, 9) + 1000, { turn: 1, step: 1, callId: "c1", name: "read" }),
      ev("tool/result", DAY(9, 1, 9) + 4000, { message: { source: { kind: "tool", callId: "c1" } } }),
      assistantMsg(DAY(9, 1, 9) + 10000, "m", 1, 1),
      ev("tool/call", DAY(9, 1, 9) + 11000, { turn: 1, step: 1, callId: "lost", name: "x" }),
    ]);
    const stats = statsFromFold(fold, NOW);
    // (10000-0) + (4000-1000) = 13000
    expect(stats.longestChatMs).toBe(13000);
  });

  it("会话间取最长；compaction usage 计入日 tokens", () => {
    const fold = makeUsageFold();
    foldSessionEvents(fold, [
      ev("step/start", DAY(9, 1, 9), { turn: 1, step: 1 }),
      assistantMsg(DAY(9, 1, 9) + 5000, "m", 1, 1),
    ]);
    foldSessionEvents(fold, [
      ev("step/start", DAY(9, 2, 9), { turn: 1, step: 1 }),
      assistantMsg(DAY(9, 2, 9) + 60000, "m", 1, 1),
    ]);
    foldSessionEvents(fold, [
      ev("compaction/summary", DAY(9, 3, 9), { compactionId: "c", usage: { inputTokens: 30, outputTokens: 5 } }),
    ]);
    const stats = statsFromFold(fold, NOW);
    expect(stats.longestChatMs).toBe(60000);
    expect(stats.totalTokens).toBe(39);
  });
});

describe("streaks（NOW=2026-09-04）", () => {
  it("今天活跃：连续到今天", () => {
    const fold = makeUsageFold();
    foldSessionEvents(fold, [assistantMsg(DAY(9, 4), "m", 1, 0), assistantMsg(DAY(9, 3), "m", 1, 0), assistantMsg(DAY(9, 2), "m", 1, 0)]);
    const s = statsFromFold(fold, NOW);
    expect(s.currentStreak).toBe(3);
    expect(s.longestStreak).toBe(3);
  });

  it("今天还没聊：从昨天回溯不算断", () => {
    const fold = makeUsageFold();
    foldSessionEvents(fold, [assistantMsg(DAY(9, 3), "m", 1, 0), assistantMsg(DAY(9, 2), "m", 1, 0)]);
    expect(statsFromFold(fold, NOW).currentStreak).toBe(2);
  });

  it("断档后最长段保留", () => {
    const fold = makeUsageFold();
    foldSessionEvents(fold, [
      assistantMsg(DAY(8, 28), "m", 1, 0), assistantMsg(DAY(8, 29), "m", 1, 0),
      assistantMsg(DAY(9, 3), "m", 1, 0),
    ]);
    const s = statsFromFold(fold, NOW);
    expect(s.currentStreak).toBe(1);
    expect(s.longestStreak).toBe(2);
  });

  it("峰值日与空折叠", () => {
    const fold = makeUsageFold();
    expect(statsFromFold(fold, NOW)).toEqual({
      days: [], totalTokens: 0, peakDayTokens: 0, longestChatMs: 0, currentStreak: 0, longestStreak: 0,
    });
    foldSessionEvents(fold, [assistantMsg(DAY(9, 1), "m", 400, 0), assistantMsg(DAY(9, 2), "m", 100, 0)]);
    expect(statsFromFold(fold, NOW).peakDayTokens).toBe(400);
  });
});

describe("modelOrderOf / lastNDayKeys / day keys", () => {
  it("模型按总量降序，零量剔除", () => {
    const fold = makeUsageFold();
    foldSessionEvents(fold, [
      assistantMsg(DAY(9, 1), "big", 900, 0),
      assistantMsg(DAY(9, 1), "small", 100, 0),
      assistantMsg(DAY(9, 2), "zero", 0, 0),
    ]);
    expect(modelOrderOf(statsFromFold(fold, NOW))).toEqual(["big", "small"]);
  });

  it("lastNDayKeys 以今天收尾且升序", () => {
    const keys = lastNDayKeys(7, NOW);
    expect(keys).toHaveLength(7);
    expect(keys[6]).toBe("2026-09-04");
    expect(keys[0]).toBe("2026-08-29");
  });

  it("dayKeyOf/addDays 跨月与补零", () => {
    expect(dayKeyOf(DAY(9, 4))).toBe("2026-09-04");
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("格式化", () => {
  it("tokens zh 用亿/万，en 用 B/M/K", () => {
    expect(formatTokensShort(1_780_000_000, "zh")).toBe("17.8亿");
    expect(formatTokensShort(4712_5000, "zh")).toBe("4712.5万");
    expect(formatTokensShort(830, "zh")).toBe("830");
    expect(formatTokensShort(1_780_000_000, "en")).toBe("1.8B");
    expect(formatTokensShort(4_712_500, "en")).toBe("4.7M");
    expect(formatTokensShort(830, "en")).toBe("830");
  });

  it("时长 zh/en 两档以上组合", () => {
    expect(formatDuration((6 * 60 + 33) * 60000, "zh")).toBe("6小时33分钟");
    expect(formatDuration(60 * 60000, "zh")).toBe("1小时");
    expect(formatDuration((2 * 1440 + 180) * 60000, "zh")).toBe("2天3小时");
    expect(formatDuration((6 * 60 + 33) * 60000, "en")).toBe("6h 33m");
    expect(formatDuration(3 * 60000, "en")).toBe("3m");
  });

  it("连续天数带单位", () => {
    expect(formatDays(5, "zh")).toBe("5天");
    expect(formatDays(5, "en")).toBe("5d");
  });
});

describe("chartMath", () => {
  it("smoothPath 起点为 M，控制点数 = 段数", () => {
    const d = smoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]);
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d.match(/ C /g)).toHaveLength(2);
    expect(smoothPath([])).toBe("");
  });

  it("arcPath 半圆用 large-arc；整圆拆两段；零 sweep 为空", () => {
    expect(arcPath(0, 0, 10, 0, Math.PI)).toContain("A 10 10 0 1 1");
    expect(arcPath(0, 0, 10, 0, Math.PI * 2).match(/A 10 10/g)).toHaveLength(2);
    expect(arcPath(0, 0, 10, 0, 0)).toBe("");
  });
});
