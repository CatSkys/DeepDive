// 触屏长按开菜单的三条硬约束：按时长触发、滚动（超阈值位移）不触发、
// 弹出后吃掉紧随的那次 click（否则菜单弹出的同时会话也被点开）。
//
// 状态是模块级的（同一时刻只可能一根手指按着；会话行是 map 出来的，行内放不下
// hook），所以每个触发过长按的用例末尾都要把"吃掉下一次 click"的标志排掉，
// 否则会漏给下一个用例——drain 的那行就是这个作用。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { longPressHandlers } from "../longPress";

type Handlers = ReturnType<typeof longPressHandlers>;
const touch = (x: number, y: number) => ({ pointerType: "touch", clientX: x, clientY: y } as never);
const mouse = (x: number, y: number) => ({ pointerType: "mouse", clientX: x, clientY: y } as never);
const clickEvent = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
const drain = (h: Handlers) => h.onClickCapture(clickEvent() as never);

describe("longPressHandlers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("触屏按住 500ms 才打开，早 1ms 不开", () => {
    const open = vi.fn();
    const h = longPressHandlers(open);
    h.onPointerDown(touch(10, 20));
    vi.advanceTimersByTime(499);
    expect(open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(open).toHaveBeenCalledWith(10, 20);
    drain(h);
  });

  it("鼠标不接管（桌面照旧走右键）", () => {
    const open = vi.fn();
    const h = longPressHandlers(open);
    h.onPointerDown(mouse(10, 20));
    vi.advanceTimersByTime(2000);
    expect(open).not.toHaveBeenCalled();
  });

  it("先松手不开", () => {
    const open = vi.fn();
    const h = longPressHandlers(open);
    h.onPointerDown(touch(10, 20));
    vi.advanceTimersByTime(300);
    h.onPointerUp();
    vi.advanceTimersByTime(1000);
    expect(open).not.toHaveBeenCalled();
  });

  it("移动超过阈值（在滚动）取消", () => {
    const open = vi.fn();
    const h = longPressHandlers(open);
    h.onPointerDown(touch(10, 20));
    h.onPointerMove(touch(10, 40)); // 纵向 20px > 8px 容差
    vi.advanceTimersByTime(1000);
    expect(open).not.toHaveBeenCalled();
  });

  it("阈值内的抖动不取消", () => {
    const open = vi.fn();
    const h = longPressHandlers(open);
    h.onPointerDown(touch(10, 20));
    h.onPointerMove(touch(13, 24)); // 位移在 8px 内
    vi.advanceTimersByTime(500);
    expect(open).toHaveBeenCalled();
    drain(h);
  });

  it("弹出后吃掉那次 click，且只吃一次", () => {
    const open = vi.fn();
    const h = longPressHandlers(open);
    h.onPointerDown(touch(1, 2));
    vi.advanceTimersByTime(500);
    expect(open).toHaveBeenCalled();

    const first = clickEvent();
    h.onClickCapture(first as never);
    expect(first.preventDefault).toHaveBeenCalled();
    expect(first.stopPropagation).toHaveBeenCalled();

    const second = clickEvent();
    h.onClickCapture(second as never);
    expect(second.preventDefault).not.toHaveBeenCalled();
  });
});
