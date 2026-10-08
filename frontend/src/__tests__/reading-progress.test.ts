// 会话阅读进度（R-001 网眼）：会话页滚动 → 侧栏会话行灰底的换算与发布。
// 读数走根元素的 --session-read（DOM 通道），所以这里在 jsdom 里钉住边界。
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishReadingProgress, readingProgressOf } from "../session/readingProgress";

/** 造一个滚动容器的读数来源：内容 3000、视口 1000 → 可滚 2000。 */
const box = (scrollTop: number) => ({ scrollTop, scrollHeight: 3000, clientHeight: 1000 });

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

describe("publishReadingProgress 发布", () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty("--session-read");
  });

  it("写进根元素的 --session-read（侧栏灰底宽度的来源）", () => {
    publishReadingProgress(0.42);
    expect(document.documentElement.style.getPropertyValue("--session-read")).toBe("0.42");
  });

  it("同一个读数不重写：滚动每帧都调，根元素样式一变整棵可见树要重算", () => {
    publishReadingProgress(0.42);
    const spy = vi.spyOn(document.documentElement.style, "setProperty");
    publishReadingProgress(0.42);
    expect(spy).not.toHaveBeenCalled();
    publishReadingProgress(0.43);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
