// 悬浮注释的**开合状态机**（壳内那份：页里什么都不画，只把锚点报上去）。
//
// 钉住的是"什么算离开"：指针从触发元素挪到**它自己的子节点**上（图标钮里最常见的动作——
// 从钮挪到钮里那颗 svg）时 `mouseout` 照样打在钮上，若照收不误就是一收一弹的一抽
// （用户 2026-10-13 报"经常抽搐"）。收在鼠标真正离开元素（或移出到外部）时才发生。
// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TooltipHost } from "../components/Tooltip";

const sent: Array<Record<string, unknown>> = [];

beforeEach(() => {
  sent.length = 0;
  // 装上壳桥（两条通道）：`shellCapabilities().tooltip` 因此为真，注释走"只上报"那条路
  (window as unknown as { webkit?: unknown }).webkit = {
    messageHandlers: {
      deepdive: { postMessage: (m: Record<string, unknown>) => sent.push(m) },
      deepdiveHost: { postMessage: () => {} },
    },
  };
});

afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-tip]").forEach((el) => el.remove());
  delete (window as unknown as { webkit?: unknown }).webkit;
});

/** 一颗带图标的图标钮（图标是钮的子节点，与真实按钮同构）。 */
function iconButton(): { button: HTMLButtonElement; icon: SVGElement } {
  const button = document.createElement("button");
  button.setAttribute("data-tip", "归档任务");
  button.setAttribute("data-tip-keys", "⌘B");
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  button.appendChild(icon);
  document.body.appendChild(button);
  return { button, icon };
}

const of = (type: string) => sent.filter((m) => m.type === type);

describe("悬浮注释的开合", () => {
  it("悬停触发元素就上报锚点与文案", () => {
    render(<TooltipHost />);
    const { button } = iconButton();
    fireEvent.mouseOver(button, { relatedTarget: document.body });
    expect(of("tooltip-show")).toHaveLength(1);
    const show = of("tooltip-show")[0];
    expect(show.text).toBe("归档任务");
    expect(show.caps).toEqual(["⌘", "B"]);
    expect(show.side).toBe("top");
    expect(typeof (show.anchor as { w: number }).w).toBe("number");
  });

  it("挪到自己的图标上不算离开", () => {
    render(<TooltipHost />);
    const { button, icon } = iconButton();
    fireEvent.mouseOver(button, { relatedTarget: document.body });
    fireEvent.mouseOut(button, { relatedTarget: icon });
    expect(of("tooltip-hide")).toHaveLength(0);
  });

  it("真移出元素才收", () => {
    render(<TooltipHost />);
    const { button } = iconButton();
    fireEvent.mouseOver(button, { relatedTarget: document.body });
    fireEvent.mouseOut(button, { relatedTarget: document.body });
    expect(of("tooltip-hide")).toHaveLength(1);
  });

  it("按下与滚动都收", () => {
    render(<TooltipHost />);
    const { button } = iconButton();
    fireEvent.mouseOver(button, { relatedTarget: document.body });
    fireEvent.mouseDown(button);
    expect(of("tooltip-hide")).toHaveLength(1);
  });
});
