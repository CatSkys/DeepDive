// makeCommitScheduler 的行为钉子：窗口内多次 schedule 合成、到期一次 flush、
// cancel 撤销未到期的合并、flush 后回到空窗可再次排。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCommitScheduler } from "../session/streamCommit";

describe("makeCommitScheduler（流式提交合帧）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("窗口内的多次 schedule 只触发一次 flush，且在 interval 之后", () => {
    let flushes = 0;
    const s = makeCommitScheduler(() => { flushes += 1; }, 32);
    s.schedule();
    s.schedule();
    s.schedule();
    vi.advanceTimersByTime(31);
    expect(flushes).toBe(0);
    vi.advanceTimersByTime(1);
    expect(flushes).toBe(1);
  });

  it("flush 之后回到空窗，下一拍可再排", () => {
    let flushes = 0;
    const s = makeCommitScheduler(() => { flushes += 1; }, 32);
    s.schedule();
    vi.advanceTimersByTime(32);
    expect(flushes).toBe(1);
    s.schedule();
    vi.advanceTimersByTime(32);
    expect(flushes).toBe(2);
  });

  it("cancel 撤掉未到期的合并，flush 不再发生", () => {
    let flushes = 0;
    const s = makeCommitScheduler(() => { flushes += 1; }, 32);
    s.schedule();
    s.cancel();
    vi.advanceTimersByTime(100);
    expect(flushes).toBe(0);
  });
});
