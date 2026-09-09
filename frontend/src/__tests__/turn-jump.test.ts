// 大纲跳转深分页驱动钉子（driveLoadThrough，官方 loadThrough 语义）：
// 覆盖到目标 seq 即止；!hasMore / 单页无前移 / 60 页上限任一触发即止。
import { describe, expect, it, vi } from "vitest";
import { driveLoadThrough } from "../session/useSessionEvents";

describe("driveLoadThrough", () => {
  it("逐页前移直到窗口覆盖目标 seq", async () => {
    // earliest 跟随回包推进（真实 hook 里 ref 即如此更新）：300→100 已覆盖 150
    const state = { v: 300 };
    const page = vi.fn(async () => {
      state.v -= 200;
      return { firstSeq: state.v, hasMore: true };
    });
    await driveLoadThrough(150, () => state.v, page);
    expect(page).toHaveBeenCalledTimes(1);
    expect(state.v).toBe(100);
  });

  it("多页推进：300→200→100 覆盖 150 需两页（每页 100）", async () => {
    const state = { v: 300 };
    const page = vi.fn(async () => {
      state.v -= 100;
      return { firstSeq: state.v, hasMore: true };
    });
    await driveLoadThrough(150, () => state.v, page);
    expect(page).toHaveBeenCalledTimes(2);
    expect(state.v).toBe(100);
  });

  it("!hasMore 立即止步（翻到日志尽头）", async () => {
    const state = { v: 300 };
    const page = vi.fn(async () => {
      state.v -= 100;
      return { firstSeq: state.v, hasMore: false };
    });
    await driveLoadThrough(0, () => state.v, page);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("单页无前移（firstSeq >= prev）即止，不空转", async () => {
    const state = { v: 300 };
    const page = vi.fn(async () => ({ firstSeq: 300, hasMore: true })); // 回包不动
    await driveLoadThrough(0, () => state.v, page);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("60 页上限封顶（引擎持续异常回包时不死循环）", async () => {
    let cur = 100000;
    const page = vi.fn(async () => {
      cur -= 1; // 每页只前移 1，永不覆盖
      return { firstSeq: cur, hasMore: true };
    });
    await driveLoadThrough(0, () => cur, page);
    expect(page).toHaveBeenCalledTimes(60);
  });
});
