// 空间横滑的跟手阻尼（useWorkspaceSwipe.damp）。钉的是一条不变量：**整片宽以内
// 必须 1:1 跟手**——早先上限截在 160px 而一片 224px，用户推到上限内容就不动了，
// 看着像卡死（2026-09-30 用户报"滑到尽头卡好一会"）。
import { describe, expect, it } from "vitest";
import { damp } from "../components/useWorkspaceSwipe";

const PANE = 224; // 侧栏默认宽 240 - 两侧内边距 8×2

describe("damp", () => {
  it("整片宽以内 1:1，不缩不滞", () => {
    for (const dx of [1, 40, 60, 120, 200, PANE]) {
      expect(damp(dx, PANE)).toBe(dx);
      expect(damp(-dx, PANE)).toBe(-dx);
    }
  });

  it("推满整片仍能到点（推得过去）", () => {
    expect(damp(PANE, PANE)).toBe(PANE);
  });

  it("超出整片宽才加阻力并封顶", () => {
    const over = damp(PANE + 100, PANE);
    expect(over).toBeGreaterThan(PANE);          // 还能再推一点
    expect(over).toBeLessThan(PANE + 100);       // 但比手指走得少
    expect(over).toBeLessThanOrEqual(PANE * 1.2); // 且有上限
  });

  it("方向符号不被阻尼吃掉", () => {
    expect(Math.sign(damp(-PANE - 80, PANE))).toBe(-1);
  });
});
