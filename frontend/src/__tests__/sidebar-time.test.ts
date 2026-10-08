// 侧栏会话时间工具（R-001 网眼）：相对时间 fmtTime 与分组标签
// bucketLabel。假时钟钉死 now，边界可复现。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bucketLabel, fmtTime } from "../session/sessionTime";

const NOW = new Date("2026-09-14T12:00:00").getTime();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("fmtTime 相对时间", () => {
  it("分/时/天/周阶梯（中英）", () => {
    expect(fmtTime(NOW - 30_000, "zh")).toBe("刚刚");
    expect(fmtTime(NOW - 5 * MIN, "zh")).toBe("5 分");
    expect(fmtTime(NOW - 5 * MIN, "en")).toBe("5m");
    expect(fmtTime(NOW - 3 * HOUR, "zh")).toBe("3 小时");
    expect(fmtTime(NOW - 3 * HOUR, "en")).toBe("3h");
    expect(fmtTime(NOW - 2 * DAY, "zh")).toBe("2 天");
    expect(fmtTime(NOW - 10 * DAY, "zh")).toBe("1 周");
    expect(fmtTime(NOW - 10 * DAY, "en")).toBe("1w");
  });
});

describe("bucketLabel 分组标签", () => {
  it("今天/昨天按日期号判定（24h 内）", () => {
    expect(bucketLabel(NOW - HOUR, "zh")).toBe("今天");
    expect(bucketLabel(NOW - HOUR, "en")).toBe("Today");
    // 23 小时前 → 已是 13 号 → 昨天
    expect(bucketLabel(NOW - 23 * HOUR, "zh")).toBe("昨天");
    expect(bucketLabel(NOW - 23 * HOUR, "en")).toBe("Yesterday");
  });

  it("7 天内 → 上周；更早 → 月份（中文数字月，英文月名）", () => {
    expect(bucketLabel(NOW - 3 * DAY, "zh")).toBe("上周");
    expect(bucketLabel(NOW - 3 * DAY, "en")).toBe("This week");
    // 30 天前 = 8 月 15 日
    expect(bucketLabel(NOW - 30 * DAY, "zh")).toBe("8 月");
    // 英文走月名：裸数字看不出是月份（用户 2026-10-08 指着侧栏那个 "9" 问过）
    expect(bucketLabel(NOW - 30 * DAY, "en")).toBe("August");
    expect(bucketLabel(new Date(2026, 0, 5, 9).getTime(), "en")).toBe("January");
  });
});
