// 会话阅读进度（R-001 网眼）：会话页滚动 → 侧栏会话行灰底的换算与逐帧收敛。
// 读数走灰底自己的 --session-read（DOM 通道），这里在 jsdom 里钉住边界与帧行为。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  placeReadingProgress,
  publishReadingProgress,
  readingProgressOf,
  setReadingBar,
} from "../session/readingProgress";

/** 造一个滚动容器的读数来源：内容 3000、视口 1000 → 可滚 2000。 */
const box = (scrollTop: number) => ({ scrollTop, scrollHeight: 3000, clientHeight: 1000 });

/** 推进 n 帧（假定时器驱动 rAF，同 useFocusStream 的测法）。 */
const frames = (n: number) => {
  for (let i = 0; i < n; i++) vi.advanceTimersByTime(16);
};

const read = (el: HTMLElement) => Number(el.style.getPropertyValue("--session-read"));

describe("readingProgressOf 读数", () => {
  it("顶部 0 / 中段 0.5 / 底部 1", () => {
    expect(readingProgressOf(box(0))).toBe(0);
    expect(readingProgressOf(box(1000))).toBe(0.5);
    expect(readingProgressOf(box(2000))).toBe(1);
  });

  it("滚不动（整段都看得见）没有读数可言 → 0，不挂满灰底", () => {
    expect(readingProgressOf({ scrollTop: 0, scrollHeight: 800, clientHeight: 1000 })).toBe(0);
    expect(readingProgressOf({ scrollTop: 0, scrollHeight: 1000, clientHeight: 1000 })).toBe(0);
  });

  it("取整到百分之一；越界值收在 0–1（估高漂移会把 scrollTop 顶出去）", () => {
    expect(readingProgressOf({ scrollTop: 700, scrollHeight: 3100, clientHeight: 1000 })).toBe(0.33);
    expect(readingProgressOf(box(2500))).toBe(1);
    expect(readingProgressOf(box(-40))).toBe(0);
  });
});

describe("publishReadingProgress 收敛", () => {
  const bar = document.createElement("span");

  beforeEach(() => {
    vi.useFakeTimers();
    setReadingBar(bar);
    placeReadingProgress(0);
    bar.style.removeProperty("--session-read");
  });
  afterEach(() => {
    setReadingBar(null);
    vi.useRealTimers();
  });

  it("写到灰底自己身上，不写根元素——写根上等于每帧重算整棵可见树", () => {
    publishReadingProgress(0.42);
    frames(30);
    expect(read(bar)).toBeCloseTo(0.42, 3);
    expect(document.documentElement.style.getPropertyValue("--session-read")).toBe("");
  });

  it("逐帧逼近：一帧只走一段，几帧内落到目标，且一路不超过它", () => {
    publishReadingProgress(0.8);
    vi.advanceTimersByTime(16);
    const first = read(bar);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.8);
    vi.advanceTimersByTime(16);
    const second = read(bar);
    expect(second).toBeGreaterThan(first);
    expect(second).toBeLessThan(0.8);
    frames(30);
    expect(read(bar)).toBeCloseTo(0.8, 3);
  });

  it("中途目标变小也不过冲：只朝目标走，不冲过它", () => {
    publishReadingProgress(1);
    frames(2);
    publishReadingProgress(0.5);
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(16);
      expect(read(bar)).toBeLessThanOrEqual(0.5);
    }
    frames(30);
    expect(read(bar)).toBeCloseTo(0.5, 3);
  });

  it("到了就收帧：收敛后不再排帧，样式也不再写", () => {
    publishReadingProgress(0.3);
    frames(40);
    const spy = vi.spyOn(bar.style, "setProperty");
    frames(10);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("同一个读数不重排帧", () => {
    publishReadingProgress(0.42);
    frames(40);
    const spy = vi.spyOn(bar.style, "setProperty");
    publishReadingProgress(0.42);
    frames(10);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("没人挂灰底（侧栏不在）时不炸，读数照样记着", () => {
    setReadingBar(null);
    publishReadingProgress(0.5);
    frames(40);
    setReadingBar(bar); // 挂上时补一次现值：不等下一次滚动
    expect(read(bar)).toBeCloseTo(0.5, 3);
  });

  it("落位：换会话时直接到位，不从上一个会话的读数扫过来", () => {
    publishReadingProgress(1);
    frames(40);
    placeReadingProgress(0);
    expect(read(bar)).toBe(0);
    publishReadingProgress(0.25);
    vi.advanceTimersByTime(16);
    expect(read(bar)).toBeGreaterThan(0);
    expect(read(bar)).toBeLessThan(0.25);
  });
});
