// 悬停点亮的语义：**指针没动过就不点亮**。列表滚动、内容重排、浮层在静止指针下
// 打开时，滑到指针底下的那一行都不该亮——那是「按位置点亮」，最像网页的一处
// （对照 tinycast 的 HoverArming + hover-arming-test，语义照抄）。
import { describe, expect, it } from "vitest";
import {
  HOVER_SLOP,
  hoverDisarmed,
  initialHoverArming,
  pointerMoved,
  type HoverArmingState,
} from "../hoverArming";

/** 指针大部分时间停的位置；具体值不重要。 */
const rest = { x: 400, y: 300 };

/** 打开时：指针已经停在行上，锚点落在那里，未点亮。 */
function shown(): HoverArmingState {
  return hoverDisarmed(initialHoverArming(), rest);
}

/** 真的移动一大步（下面每个「已点亮」的用例都这么起步）。 */
function armed(): HoverArmingState {
  return pointerMoved(shown(), rest.x + 40, rest.y);
}

describe("悬停点亮", () => {
  it("刚打开时未点亮，且一次零位移的移动不会点亮", () => {
    const state = shown();
    expect(state.armed).toBe(false);
    expect(pointerMoved(state, rest.x, rest.y).armed).toBe(false);
  });

  it("换视图后重新复位（新列表里那一行不是指针选的）", () => {
    expect(hoverDisarmed(armed(), rest).armed).toBe(false);
  });

  it("指针移过容差距离就点亮", () => {
    expect(armed().armed).toBe(true);
  });

  it("按距离判定，不是按轴：斜着走 (3,3) 也算动过", () => {
    const diagonal = pointerMoved(shown(), rest.x + HOVER_SLOP, rest.y + HOVER_SLOP);
    expect(diagonal.armed).toBe(true);
  });

  it("锚点只在点亮时移动，所以一像素一像素地蹭也会累积", () => {
    let state = shown();
    for (let step = 1; step <= HOVER_SLOP + 1; step++) {
      state = pointerMoved(state, rest.x + step, rest.y);
    }
    expect(state.armed).toBe(true);
  });
});

describe("滚动与复位", () => {
  it("滚动把点亮丢掉", () => {
    expect(hoverDisarmed(armed(), rest).armed).toBe(false);
  });

  it("滚轮手势里手抖一像素一档，累积不起来（每一档都重新落锚点）", () => {
    let state = armed();
    for (let step = 1; step <= 20; step++) {
      const at = { x: rest.x + step, y: rest.y };
      state = hoverDisarmed(state, at);
      state = pointerMoved(state, at.x, at.y);
    }
    expect(state.armed).toBe(false);
  });

  it("手势结束时那个零位移的 pointermove 不会重新点亮", () => {
    const state = hoverDisarmed(armed(), rest);
    expect(pointerMoved(state, rest.x, rest.y).armed).toBe(false);
  });

  it("手停在鼠标上把它蹭动一两个像素也不算", () => {
    const state = hoverDisarmed(armed(), rest);
    expect(pointerMoved(state, rest.x + 2, rest.y + 1).armed).toBe(false);
  });

  it("之后真的移动一次，点亮回来", () => {
    const state = hoverDisarmed(armed(), rest);
    expect(pointerMoved(state, rest.x + 12, rest.y).armed).toBe(true);
  });

  it("已复位时再复位是幂等的（不重复动 DOM）", () => {
    const once = hoverDisarmed(armed(), rest);
    const twice = hoverDisarmed(once, rest);
    expect(twice.armed).toBe(false);
    expect(twice.anchor).toEqual(rest);
  });
});
