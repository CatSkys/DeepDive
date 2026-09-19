// 流式对焦揭示（useFocusStream）：受控节奏、指数追赶、失活即补齐。
// 用假定时器驱动 rAF 帧循环，直接断言每帧揭示量与收敛行为。
// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFocusStream } from "../session/useFocusStream";

function Probe({ full, active }: { full: string; active: boolean }) {
  const shown = useFocusStream(full, active);
  return <div data-len={shown.length}>{shown}</div>;
}

const len = (container: HTMLElement) =>
  Number((container.firstChild as HTMLElement).dataset.len);

describe("useFocusStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("active 时不整段闪现：逐帧受控揭示", () => {
    const { container } = render(<Probe full={"x".repeat(100)} active />);
    expect(len(container)).toBe(0);
    act(() => { vi.advanceTimersByTime(16); });
    const first = len(container);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(100);
  });

  it("快档：整句/整行揭示——一步推进到句末标点或换行", () => {
    const { container } = render(<Probe full="深夜的代码在屏幕上流淌。海风穿过机房。" active />);
    act(() => { vi.advanceTimersByTime(16); });
    expect((container.firstChild as HTMLElement).textContent).toBe("深夜的代码在屏幕上流淌。");
  });

  it("慢档：涓流逐字揭示", () => {
    const { container } = render(<Probe full="慢慢来" active />);
    act(() => { vi.advanceTimersByTime(16); });
    expect((container.firstChild as HTMLElement).textContent).toBe("慢");
  });

  it("快模型整段到达也能追平：落后量指数收敛，不拖尾", () => {
    const { container, rerender } = render(<Probe full="" active />);
    // 一次到 5000 字（快模型整段 burst）：~5 帧量级持续收敛，一秒内凝完
    rerender(<Probe full={"x".repeat(5000)} active />);
    act(() => { vi.advanceTimersByTime(16 * 60); });
    expect(len(container)).toBe(5000);
  });

  it("失活（工具行接管/轮次结束）立即补齐，不留半截", () => {
    const { container, rerender } = render(<Probe full={"x".repeat(50)} active />);
    act(() => { vi.advanceTimersByTime(16); });
    expect(len(container)).toBeLessThan(50);
    rerender(<Probe full={"x".repeat(50)} active={false} />);
    expect(len(container)).toBe(50);
  });

  it("非活跃项（历史 chunk）直接整段显示，不播揭示", () => {
    const { container } = render(<Probe full={"x".repeat(80)} active={false} />);
    expect(len(container)).toBe(80);
  });
});
