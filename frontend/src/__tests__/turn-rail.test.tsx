// Turn 大纲轨组件钉子：指示器跟随（hover 优先/无 hover 停活动轮）与预览卡
// 常驻挂载契约（关合只翻 data-open，元素不卸载——出场淡出依赖它）。
// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TurnNavigator } from "../session/TurnNavigator";
import { FOLLOW_THRESHOLD, activeTurnFor, readingLineOffset } from "../session/activeTurn";
import type { TurnOutlineEntry } from "../types";

const entry = (turn: number, seq: number): TurnOutlineEntry => ({
  turn, seq, prompt: `第${turn}轮提问`, response: `第${turn}轮回答`,
});

const props = {
  entries: [entry(1, 4), entry(2, 40), entry(3, 90)],
  busyTurn: undefined,
  loadedTurns: new Set([1, 2, 3]),
  onPick: () => {},
};

afterEach(cleanup);

describe("TurnNavigator", () => {
  it("指示器常驻停在活动轮（data-show），hover 他轮后跟随 hover 轮", () => {
    const { container } = render(<TurnNavigator {...props} activeTurn={2} />);
    const cursor = container.querySelector<HTMLElement>(".turn-rail-cursor")!;
    expect(cursor).not.toBeNull();
    expect(cursor.hasAttribute("data-show")).toBe(true);
    expect(cursor.style.top).not.toBe("");

    const mark3 = container.querySelector<HTMLElement>('[data-turn="3"]')!;
    fireEvent.mouseEnter(mark3);
    // cursorTurn=3：指示器元素仍在且保持显示（top 已向目标更新）
    expect(cursor.hasAttribute("data-show")).toBe(true);

    fireEvent.mouseLeave(container.querySelector("nav")!);
    // hover 离开：回落活动轮（data-show 保持，指示器不消失）
    expect(cursor.hasAttribute("data-show")).toBe(true);
  });

  it("预览卡：hover 弹出（data-open）→ 离开后元素仍在（仅收 data-open）", () => {
    const { container } = render(<TurnNavigator {...props} activeTurn={1} />);
    expect(container.querySelector(".turn-rail-tip")).toBeNull(); // 未 hover 不渲染

    fireEvent.mouseEnter(container.querySelector<HTMLElement>('[data-turn="2"]')!);
    const tip = container.querySelector<HTMLElement>(".turn-rail-tip")!;
    expect(tip.hasAttribute("data-open")).toBe(true);
    expect(tip.textContent).toContain("第2轮提问");

    fireEvent.mouseLeave(container.querySelector("nav")!);
    // 出场淡出依赖常驻挂载：元素不卸载、内容不清空，只收 data-open
    expect(container.querySelector(".turn-rail-tip")).toBe(tip);
    expect(tip.hasAttribute("data-open")).toBe(false);
    expect(tip.textContent).toContain("第2轮提问");

    // 换刻度再开：同一元素复用，内容与 data-open 翻回
    fireEvent.mouseEnter(container.querySelector<HTMLElement>('[data-turn="3"]')!);
    expect(container.querySelector(".turn-rail-tip")).toBe(tip);
    expect(tip.hasAttribute("data-open")).toBe(true);
    expect(tip.textContent).toContain("第3轮提问");
  });

  it("无 hover 且无活动轮时指示器不显示；未加载轮 aria-label 为载入语义", () => {
    const { container } = render(
      <TurnNavigator {...props} activeTurn={undefined} loadedTurns={new Set([1])} />,
    );
    const cursor = container.querySelector(".turn-rail-cursor");
    if (cursor) expect(cursor.hasAttribute("data-show")).toBe(false);
    const mark2 = container.querySelector<HTMLElement>('[data-turn="2"]')!;
    expect(mark2.getAttribute("aria-label")).toContain("载入并跳转到第 2 轮");
    const mark1 = container.querySelector<HTMLElement>('[data-turn="1"]')!;
    expect(mark1.getAttribute("aria-label")).toContain("跳转到第 1 轮");
  });
});

// 活动轮判定（纯函数，照官方 ChatView.syncActiveTurn 的两条规则）：
// ① 贴底 → 最后一轮（此前漏了这条：滑到最新时活动刻度总少一轮）；
// ② 否则阅读线上方最新一轮，且必须映射到刻度轨真提供的那一轮。
describe("activeTurnFor", () => {
  const turns = [1, 2, 5, 9];

  it("贴底取最后一轮（哪怕阅读线还停在上一轮）", () => {
    expect(activeTurnFor(true, 5, turns)).toBe(9);
    expect(activeTurnFor(true, null, turns)).toBe(9);
  });

  it("非贴底按阅读轮映射到刻度轨提供的轮（比阅读轮新的不取）", () => {
    expect(activeTurnFor(false, 5, turns)).toBe(5);
    expect(activeTurnFor(false, 4, turns)).toBe(2);
    expect(activeTurnFor(false, 100, turns)).toBe(9);
  });

  it("阅读线之上无轮 → 首轮（头部占位）；刻度为空 → null", () => {
    expect(activeTurnFor(false, null, turns)).toBe(1);
    expect(activeTurnFor(true, 3, [])).toBeNull();
  });

  it("阅读线偏移 = min(96, 20% 视口高)", () => {
    expect(readingLineOffset(400)).toBe(80);
    expect(readingLineOffset(1000)).toBe(96);
    expect(FOLLOW_THRESHOLD).toBe(24);
  });
});
