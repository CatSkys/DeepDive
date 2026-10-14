// 浮层落位（components/floatingPlacement）：菜单永不出视口、翻上方不盖触发器。
//
// 两轮用户报障各钉住一条：
//   · 2026-10-14「弹层位置容易跑到外面去，窗口小了后」——限高写了 `Math.max(180, …)` 的
//     下限（比余量还大）、夹右缘用的是触发器宽而不是菜单宽、翻上方时菜单盖住自己的触发器。
//   · 2026-10-14「你这修到左边去了」——"先量后落位"那帧只覆盖了 `left`，`.ddMenu` 类自带的
//     `right: 0` 仍在，left+right 双约束把宽度解成整个视口宽；量回来的宽＝视口宽，
//     夹右缘算成负数 → 菜单被钉在左边 8px。**jsdom 不做布局，这条只能靠"测量帧的几何"
//     这一条断言来钉**（真机实测见 measuringStyle 的注释）。
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { measuringStyle, placeFloating } from "../components/floatingPlacement";
import { Dropdown } from "../components/controls";

const MARGIN = 8;

function setViewport(w: number, h: number) {
  Object.defineProperty(window, "innerWidth", { value: w, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: h, configurable: true });
}

/** 锚点：只要 top/bottom/left/right/width 五个数（DOMRect 结构上满足同一形状）。 */
function anchor(top: number, left: number, height: number, width: number) {
  return { top, bottom: top + height, left, right: left + width, width };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setViewport(1024, 768);
});

describe("placeFloating · 纵向", () => {
  it("下方放得下就贴下方：菜单顶边 = 锚点底边 + 间距", () => {
    setViewport(800, 600);
    const p = placeFloating(anchor(100, 40, 30, 60), { width: 148, height: 130 });
    expect(p.below).toBe(true);
    expect(p.top).toBe(134);
    expect(p.maxHeight).toBe(130);
  });

  it("下方放不下、上方更宽裕就翻上去：菜单底边贴锚点**上缘**，不盖触发器", () => {
    setViewport(800, 300);
    const a = anchor(200, 40, 30, 60);
    const p = placeFloating(a, { width: 148, height: 130 });
    expect(p.below).toBe(false);
    // 底边落在锚点上缘之上（留间距）——不是锚点下缘，后者会让菜单盖住自己的触发器
    expect(p.top + p.maxHeight).toBe(a.top - 4);
  });

  it("两侧都放不下时限高＝更宽裕那一侧的**实际余量**，绝不出视口", () => {
    setViewport(800, 200);
    const a = anchor(90, 40, 30, 60);
    const p = placeFloating(a, { width: 148, height: 130 });
    expect(p.maxHeight).toBeLessThan(130);          // 内容高被真实余量压住
    expect(p.top).toBeGreaterThanOrEqual(MARGIN);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(window.innerHeight - MARGIN);
  });

  it("窗口高度扫一遍：任何高度、任何锚点位置都不出上下缘", () => {
    for (let h = 120; h <= 900; h += 20) {
      setViewport(800, h);
      // 锚点在窗口里从上到下走一遍（含贴近上下缘的极端位）
      for (let top = 0; top <= h - 30; top += Math.max(1, Math.floor(h / 7))) {
        const p = placeFloating(anchor(top, 40, 30, 60), { width: 148, height: 130 });
        expect(p.top).toBeGreaterThanOrEqual(MARGIN);
        expect(p.top + p.maxHeight).toBeLessThanOrEqual(h - MARGIN);
      }
    }
  });
});

describe("measuringStyle · 量尺寸那一帧", () => {
  it("必须把 right/bottom 归 auto：否则 .ddMenu 自带的 right:0 把宽度撑成视口宽", () => {
    const st = measuringStyle(148);
    expect(st.position).toBe("fixed");
    expect(st.right).toBe("auto");
    expect(st.bottom).toBe("auto");
    expect(st.visibility).toBe("hidden");
    expect(st.minWidth).toBe(148);
    expect(st.maxHeight).toBeUndefined();      // 加了就量不到自然高度
    expect(st.overflowY).toBeUndefined();
  });
});

describe("placeFloating · 水平", () => {
  it("菜单比触发器宽时，左侧要按**菜单宽**夹，右缘不出视口", () => {
    setViewport(380, 600);
    const a = anchor(100, 300, 30, 51);            // 触发器贴右缘
    const p = placeFloating(a, { width: 148, height: 130 });
    expect(p.left).toBe(380 - 148 - MARGIN);
    expect(p.left + 148).toBeLessThanOrEqual(380 - MARGIN);
  });

  it("align=right：菜单右缘对齐锚点右缘", () => {
    setViewport(800, 600);
    const a = anchor(100, 300, 30, 51);
    const p = placeFloating(a, { width: 148, height: 130 }, { align: "right" });
    expect(p.left).toBe(300 + 51 - 148);
  });

  it("窗口比菜单还窄时退到左缘（不出左缘）", () => {
    setViewport(100, 600);
    const p = placeFloating(anchor(100, 80, 30, 20), { width: 148, height: 130 });
    expect(p.left).toBe(MARGIN);
  });

  it("实测来的盒子带 inset：限高要扣掉它自己的内垫+边框（content-box 的 max-height）", () => {
    setViewport(800, 200);
    const p = placeFloating(anchor(90, 40, 30, 60), { width: 148, height: 130, inset: 10 });
    // 余量 78 → 限高 78 - 10；整个盒子 = 68 + 10 = 78 ≤ 余量
    expect(p.maxHeight).toBe(68);
    expect(p.top + p.maxHeight + 10).toBeLessThanOrEqual(200 - MARGIN);
  });
});

describe("Dropdown · 落位（用户报的那处）", () => {
  /** jsdom 不做布局，getBoundingClientRect 全零——按元素角色桩出真实形状：
   *  触发器 51 宽贴在窗口右缘，菜单被内容撑到 148×130（比触发器宽）。 */
  function stubRects() {
    const box = (o: { top: number; left: number; width: number; height: number }) => ({
      ...o, bottom: o.top + o.height, right: o.left + o.width, x: o.left, y: o.top, toJSON: () => ({}),
    }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("role") === "listbox"
        ? box({ top: 0, left: 0, width: 148, height: 130 })
        : box({ top: 40, left: 300, width: 51, height: 30 });
    });
  }

  function openMenu() {
    const { container } = render(
      <Dropdown
        options={[{ v: "off", label: "Off" }, { v: "high", label: "High" }]}
        value="high"
        onChange={() => {}}
      />,
    );
    fireEvent.click(container.querySelector("button")!);
    return container.ownerDocument.querySelector<HTMLElement>('[role="listbox"]')!;
  }

  it("窄窗口：菜单按自身宽度夹进视口，不出右缘", () => {
    setViewport(380, 600);
    stubRects();
    const menu = openMenu();
    const left = Number.parseFloat(menu.style.left);
    expect(left + 148).toBeLessThanOrEqual(380 - MARGIN);
    expect(menu.style.visibility).not.toBe("hidden");   // 量完就落位，不停在隐藏态
  });

  it("矮窗口：限高＝真实余量，不出下缘", () => {
    setViewport(800, 200);
    stubRects();
    const menu = openMenu();
    const top = Number.parseFloat(menu.style.top);
    expect(top + Number.parseFloat(menu.style.maxHeight)).toBeLessThanOrEqual(200 - MARGIN);
    expect(menu.style.bottom).toBe("auto");             // 双约束会把菜单压成细条（PITFALLS §1.7）
  });
});
