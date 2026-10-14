/**
 * 浮层（菜单 / 下拉 / 详情卡）贴锚点落位的**唯一一份算术**：贴下方还是翻上方、限高多少、
 * 左右夹到哪。只管几何——尺寸由调用方给（常量或实测），题材、渲染、开合都不在这里。
 *
 * 两条硬约束（破了就是"菜单跑到窗口外面"，PITFALLS §1.7）：
 * 1. `maxHeight` 永远等于所选那一侧的**实际余量**，不给下限：给下限就等于允许出视口。
 *    内容高过余量时靠调用方的 `overflow-y: auto` 内滚。
 * 2. 返回**绝对 `top`**（不回 `bottom`）：`.ddMenu` / `.model-menu` 这类类自带
 *    `top: calc(100% + 4px)`，调用方只写 `top` + `bottom: "auto"`，不会踩
 *    top/bottom 双约束把菜单压成细条（PITFALLS §1.7）。
 * 3. 翻上方时菜单**底边贴锚点的上缘**（`anchor.top - gap`），不贴锚点的下缘——后者会让
 *    菜单盖住自己的触发器。
 *
 * 宽度为什么要实测：菜单宽由内容撑（触发器宽 ≠ 菜单宽），拿触发器宽去夹右缘会让菜单
 * 探出屏幕右侧。所以"内容撑宽"的菜单要走 `useFloatingBox`（先渲染、量完再落位）。
 */
import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

/** 锚点矩形：`DOMRect` 结构上就满足它（单测可直接造字面量，不必进 DOM）。 */
export interface FloatingAnchor {
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** 锚点自身的宽（触发器的宽）：菜单最小宽的来源，落位算术本身不用它。 */
  width: number;
}

export interface FloatingSize {
  width: number;
  height: number;
}

export interface FloatingPlacement {
  top: number;
  left: number;
  maxHeight: number;
  /** 贴的是哪一侧。调用方一般不关心，留给调试与断言。 */
  below: boolean;
}

/** 与锚点的间距、与视口四边的最小留白。 */
const GAP = 4;
const MARGIN = 8;

/** 锚点 + 菜单尺寸 → 菜单该用的内联几何。纯函数：同一份输入永远同一份输出。 */
export function placeFloating(
  anchor: FloatingAnchor,
  size: FloatingSize,
  opts: { align?: "left" | "right" } = {},
): FloatingPlacement {
  const below = window.innerHeight - MARGIN - anchor.bottom - GAP;
  const above = anchor.top - GAP - MARGIN;
  // 下方放得下就走下方；放不下时取余量更大的一侧（相等偏向下方——菜单贴触发器更自然）
  const openBelow = below >= size.height || below >= above;
  const room = Math.max(0, openBelow ? below : above);
  const height = Math.min(size.height, room);
  const top = openBelow ? anchor.bottom + GAP : anchor.top - GAP - height;
  const left = opts.align === "right"
    ? Math.max(MARGIN, Math.min(anchor.right - size.width, window.innerWidth - size.width - MARGIN))
    : Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - size.width - MARGIN));
  return {
    top: Math.min(Math.max(MARGIN, top), window.innerHeight - MARGIN),
    left,
    maxHeight: height,
    below: openBelow,
  };
}

/** 菜单落位用的实测值：锚点矩形 + 菜单自身的宽高。 */
export interface FloatingBox {
  anchor: FloatingAnchor;
  width: number;
  height: number;
}

/**
 * "先渲染、量完再落位"：打开时菜单先按 `visibility: hidden` 渲一帧，本帧内量出真实尺寸
 * 再换成落位后的几何（在 `useLayoutEffect` 里 setState——两帧都在 paint 之前，用户只看到
 * 落位后的那一帧，没有闪动）。
 *
 * 调用方约定：`box === null` 时把菜单渲成不可见、位置随意，且**不要**加 `maxHeight`
 * （加上就量不到自然高度）、**要**带上最终的最小宽（量出来的宽必须等于落位后的宽，
 * 否则夹右缘用的还是错的数）。宽度只有量了才知道，所以内容撑宽的菜单必须走这条。
 */
export function useFloatingBox(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
): FloatingBox | null {
  const [box, setBox] = useState<FloatingBox | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }
    if (box !== null) return;
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const a = anchor.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    setBox({ anchor: a, width: m.width, height: m.height });
  }, [open, box, anchorRef, menuRef]);
  return box;
}
