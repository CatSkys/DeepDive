// 浮层落位（components/floatingPlacement）：菜单永不出视口、翻上方不盖触发器。
//
// 用户 2026-10-14 报「弹层位置容易跑到外面去，窗口小了后」——症状出在 HeroPanel 那条
// Dropdown（思考强度/权限/发送方式）：菜单宽由内容撑（≈88），夹右缘用的却是触发器宽
// （≈51），于是窗口一窄菜单就探出右缘；矮窗口下 `max-height` 又有个 180 的下限，
// 比实际余量还大，菜单从窗顶/窗底出去一截。
//
// 这一份量的是**纯算术**（`placeFloating`）：结果以内联样式给出，所以断言读样式、不读元素
// 几何。壳那一侧（量实测尺寸、落样式、开合）在 `components/Popover.tsx`。
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { placeFloating, type FloatingPlacement } from "../components/floatingPlacement";
import { Dropdown } from "../components/controls";

const MARGIN = 8;

function setViewport(w: number, h: number) {
  Object.defineProperty(window, "innerWidth", { value: w, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: h, configurable: true });
}

/** 锚点：只要 top/bottom/left/right/width/height 六个数（DOMRect 结构上满足同一形状）。 */
function anchor(top: number, left: number, height: number, width: number) {
  return { top, bottom: top + height, left, right: left + width, width, height };
}

/** 从落位结果反推"盒子"：绝对 top 由 `top` 或 `bottom + maxHeight` 定（翻上方时是后者）。 */
function boxOf(p: FloatingPlacement) {
  const s = p.style;
  const at = (v: unknown) => Number.parseFloat(String(v));
  const maxHeight = at(s.maxHeight);
  return {
    top: s.top === "auto" ? window.innerHeight - at(s.bottom) - maxHeight : at(s.top),
    left: at(s.left),
    maxHeight,
    below: p.side === "bottom",
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setViewport(1024, 768);
});

describe("placeFloating · 纵向", () => {
  it("下方放得下就贴下方：菜单顶边 = 锚点底边 + 间距", () => {
    setViewport(800, 600);
    const p = boxOf(placeFloating(anchor(100, 40, 30, 60), { size: 148, cross: 148, height: 130 }));
    expect(p.below).toBe(true);
    expect(p.top).toBe(134);
    // 余量远大于内容：限高按**余量**给，实际高度由内容决定（超了才内滚）
    expect(p.maxHeight).toBeGreaterThanOrEqual(130);
  });

  it("下方放不下、上方更宽裕就翻上去：菜单底边贴锚点**上缘**，不盖触发器", () => {
    setViewport(800, 300);
    const a = anchor(200, 40, 30, 60);
    const p = boxOf(placeFloating(a, { size: 148, cross: 148, height: 130 }));
    expect(p.below).toBe(false);
    // 底边落在锚点上缘之上（留间距）——不是锚点下缘，后者会让菜单盖住自己的触发器
    expect(p.top + p.maxHeight).toBe(a.top - 4);
  });

  it("两侧都放不下时限高＝更宽裕那一侧的**实际余量**，绝不出视口", () => {
    setViewport(800, 200);
    const a = anchor(90, 40, 30, 60);
    const p = boxOf(placeFloating(a, { size: 148, cross: 148, height: 130 }));
    expect(p.maxHeight).toBeLessThan(130);          // 内容高被真实余量压住
    expect(p.top).toBeGreaterThanOrEqual(MARGIN);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(window.innerHeight - MARGIN);
  });

  it("窗口高度扫一遍：任何高度、任何锚点位置都不出上下缘", () => {
    for (let h = 120; h <= 900; h += 20) {
      setViewport(800, h);
      // 锚点在窗口里从上到下走一遍（含贴近上下缘的极端位）
      for (let top = 0; top <= h - 30; top += Math.max(1, Math.floor(h / 7))) {
        const p = boxOf(placeFloating(anchor(top, 40, 30, 60), { size: 148, cross: 148, height: 130 }));
        expect(p.top).toBeGreaterThanOrEqual(MARGIN);
        expect(p.top + p.maxHeight).toBeLessThanOrEqual(h - MARGIN);
      }
    }
  });
});

describe("placeFloating · 横向", () => {
  it("菜单比触发器宽时，左侧要按**菜单宽**夹，右缘不出视口", () => {
    setViewport(380, 600);
    const a = anchor(100, 300, 30, 51);            // 触发器贴右缘
    const p = boxOf(placeFloating(a, { size: 148, cross: 148, height: 130 }));
    expect(p.left).toBe(380 - 148 - MARGIN);
    expect(p.left + 148).toBeLessThanOrEqual(380 - MARGIN);
  });

  it("align=end：菜单右缘对齐锚点右缘", () => {
    setViewport(800, 600);
    const a = anchor(100, 300, 30, 51);
    const p = boxOf(placeFloating(a, { size: 148, cross: 148, height: 130, align: "end" }));
    expect(p.left).toBe(300 + 51 - 148);
  });

  it("窗口比菜单还窄时退到左缘（不出左缘）", () => {
    setViewport(100, 600);
    const p = boxOf(placeFloating(anchor(100, 80, 30, 20), { size: 148, cross: 148, height: 130 }));
    expect(p.left).toBe(MARGIN);
  });

  it("横开（side=left/right）：贴锚点那条边，左边放不下翻到右边", () => {
    setViewport(800, 600);
    const left = placeFloating(anchor(100, 300, 30, 51), { side: "left", size: 240, cross: 200, gap: 10 });
    expect(left.side).toBe("left");
    expect(left.style.right).toBe(800 - 300 + 10);
    // 锚点贴左缘时左侧没地方 → 翻到右缘外侧
    const flipped = placeFloating(anchor(100, 20, 30, 51), { side: "left", size: 240, cross: 200, gap: 10 });
    expect(flipped.side).toBe("right");
    expect(flipped.style.left).toBe(20 + 51 + 10);
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
