// 横滑的坐标连续性（useWorkspaceSwipe 的坐标决策）。
//
// 这组测试盯的是唯一真正要命的不变量：**目标那片在屏幕上的位置，从拖动开始到切换、
// 再到收尾结束，全程不得出现跳变**。前几版手感崩掉的原因全在这里——切换瞬间把静止位
// 从 0 改成 -100%，整条内容瞬移一整片宽（224px）；DOM 顺序跟着换，位置又再错一次。
// 光看代码看不出来，必须把坐标算成数字。
import { describe, expect, it } from "vitest";
import { paneX, restAfterSwap, restBefore } from "../components/useWorkspaceSwipe";

const W = 224; // 侧栏内容宽（240 − 两侧内边距 8×2）

/**
 * 走一遍"往下一个"的完整手势，每一步记录目标片（B）的屏幕 x。
 * dir=+1 表示下一片在右侧：切换前布局 [A, B]（B 在 index 1），切换后 B 成当前片。
 */
function traceNext(drags: number[]) {
  const base = restBefore(+1, W);
  const trace: number[] = [];
  let swapped = false;
  for (const drag of drags) {
    // 切换前：B 是邻居、在右 → neighborLeft=false
    if (!swapped) trace.push(paneX("neighbor", false, base + drag, W));
    // 切换后：布局仍是 [A, B]（B 从邻居变成当前片，DOM 顺序没变），
    // 只是 neighborLeft 翻成 true（B 成了 index 1 的当前片）。
    else trace.push(paneX("active", true, base + drag, W));
    if (Math.abs(drag) >= W * 0.5) swapped = true;
  }
  return { trace, base };
}

function tracePrev(drags: number[]) {
  const base = restBefore(-1, W);
  const trace: number[] = [];
  let swapped = false;
  for (const drag of drags) {
    // 切换前：上一片在左 → neighborLeft=true，A（当前片）在 index 1
    if (!swapped) trace.push(paneX("neighbor", true, base + drag, W));
    // 切换后：布局仍是 [B, A]，B 成了 index 0 的当前片 → neighborLeft=false
    else trace.push(paneX("active", false, base + drag, W));
    if (Math.abs(drag) >= W * 0.5) swapped = true;
  }
  return { trace, base };
}

describe("横滑坐标", () => {
  it("切换那一帧目标片不跳（往下一个）", () => {
    // 拖到刚好过半片宽的那一步前后
    const { trace } = traceNext([-110, -111, -112, -113, -114]);
    for (let i = 1; i < trace.length; i++) {
      expect(Math.abs(trace[i] - trace[i - 1])).toBeLessThanOrEqual(1.001);
    }
  });

  it("切换那一帧目标片不跳（往上一个）", () => {
    const { trace } = tracePrev([110, 111, 112, 113, 114]);
    for (let i = 1; i < trace.length; i++) {
      expect(Math.abs(trace[i] - trace[i - 1])).toBeLessThanOrEqual(1.001);
    }
  });

  it("拖到满位松手时目标片正好居中（往下一个）", () => {
    const { base } = traceNext([-224]);
    // 满位时 t = -W；收尾把 base 改成 restAfterSwap(+1) = -W，与当前一致 → 无位移
    expect(base + -224).toBe(restAfterSwap(+1, W));
    expect(paneX("active", true, restAfterSwap(+1, W), W)).toBe(0);
  });

  it("拖到满位松手时目标片正好居中（往上一个）", () => {
    const { base } = tracePrev([224]);
    expect(base + 224).toBe(restAfterSwap(-1, W));
    expect(paneX("active", false, restAfterSwap(-1, W), W)).toBe(0);
  });

  it("收尾过渡的长度 = 当前位移与静止位之差（不会长距离乱飞）", () => {
    // 往下一个：拖到 -150 就松手，收尾要从 -150 补到 -224，只走 74px
    const t = restBefore(+1, W) + -150;
    expect(Math.abs(restAfterSwap(+1, W) - t)).toBe(74);
    // 往上一个：拖到 +150 松手，从 0+(-224+150)=-74 补到 0，走 74px
    const t2 = restBefore(-1, W) + 150;
    expect(Math.abs(restAfterSwap(-1, W) - t2)).toBe(74);
  });

  it("切换前的静止位与方向对应（下一在右=0，上一在左=-W）", () => {
    expect(restBefore(+1, W)).toBe(0);
    expect(restBefore(-1, W)).toBe(-W);
  });
});
