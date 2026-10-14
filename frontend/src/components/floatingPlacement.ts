/**
 * 浮层（菜单 / 下拉 / 详情卡）贴锚点落位的**唯一一份算术**：贴哪一侧、限多少、另一条轴夹到哪。
 * 只管几何——尺寸由调用方给（常量或实测），题材、渲染、开合都不在这里。
 * 消费方是 `components/Popover.tsx`（全站浮层的唯一壳），它把这份结果落成内联样式。
 *
 * 三条硬约束（破了就是"菜单跑到窗口外面"，PITFALLS §1.7）：
 * 1. `maxHeight` 永远等于所选那一侧的**实际余量**，不给下限：给下限就等于允许出视口。
 *    内容高过余量时靠调用方的 `overflow-y: auto` 内滚。
 * 2. 另一条轴的尺寸**必须实测**（触发器宽 ≠ 菜单宽）：拿触发器宽去夹右缘会让菜单探出屏幕
 *    右侧。所以 Popover 不给 `size` 时会先渲染一帧、量完真实尺寸再落位。
 * 3. 翻到上方时菜单**底边贴锚点的上缘**（`anchor.top - gap`），不贴锚点的下缘——后者会让
 *    菜单盖住自己的触发器。四条边**全部显式写死**（用不上的那条写 `auto`）：`.ddMenu` /
 *    `.model-menu` 这类类自带 `top: calc(100% + 4px)`，只设 `bottom` 会踩 top/bottom
 *    双约束把菜单压成细条（PITFALLS §1.7 第二个实例）；同理，量尺寸的那一帧也必须四边全写，
 *    否则类自带的 `right: 0` 会把宽度解成视口宽，夹右缘算出负数、菜单被钉在左缘 8px
 *    （用户 2026-10-14「你这修到左边去了」，PITFALLS §1.7 第三个实例）。
 * 4. `max-height` 是**内容盒**的尺寸，得扣掉宿主自己的 padding+border（`inset`），不然
 *    盒子比余量还高一截。
 */
import type { CSSProperties } from "react";

/** 锚点矩形：`DOMRect` 结构上就满足它（单测可直接造字面量，不必进 DOM）。 */
export interface FloatingAnchor {
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** 锚点自身的宽：`size: "anchor"` 时就是菜单的宽。 */
  width: number;
  height: number;
  /** 该面自身的**垂直**内垫 + 边框。`.ddMenu` 这类面是 content-box，CSS 的 `max-height`
   *  限的是内容盒：实测来的盒子要带上它，限高才不会比余量多出这一截（10px 就能从窗底探出去）。
   *  声明成"上限"的尺寸（照 CSS 类里 max-height 抄的常量）不带它。 */
  inset?: number;
}

/** 贴锚点的哪一边。放不下时翻到对面。 */
export type FloatingSide = "top" | "bottom" | "left" | "right";
/** 沿锚点的哪条边对齐：竖开的取横轴，横开的取纵轴。 */
export type FloatingAlign = "start" | "center" | "end";

export interface FloatingOptions {
  /** 期望开向，默认下方。 */
  side?: FloatingSide;
  /** 与锚点的间距（默认 4）。 */
  gap?: number;
  /** 与视口四边的最小留白（默认 8）。 */
  margin?: number;
  align?: FloatingAlign;
  /** 沿着对齐轴再挪一点（负值往锚点里收）。 */
  alignOffset?: number;
  /** 要固定下来的那条尺寸；`"anchor"` = 与锚点同宽。不给则由 `cross` 参与对齐与收敛。 */
  size?: number | "anchor";
  /** 另一条轴的实测尺寸（竖开的宽 / 横开的高）。 */
  cross?: number;
  /** 内容高度估计：竖开时参与翻面判定（估大了只是翻得更早，不会出视口）。 */
  height?: number;
  /** 限高的硬上限。 */
  maxHeight?: number;
  /** 宿主沿**滚动轴**的 padding+border：`max-height` 是内容盒的，不减掉它盒子会比余量高一截。 */
  inset?: number;
}

export interface FloatingPlacement {
  /** 直接落给浮层宿主的内联样式（已含 `transform-origin`）。 */
  style: CSSProperties;
  /** 实际落定的开向（翻面后与请求的 `side` 不同，调用方可能要翻箭头）。 */
  side: FloatingSide;
  /** 内容超限时该滚哪一轴——竖开滚纵向、横开滚横向。 */
  axis: "height" | "width";
}

const GAP = 4;
const MARGIN = 8;

const OPPOSITE: Record<FloatingSide, FloatingSide> = {
  top: "bottom", bottom: "top", left: "right", right: "left",
};

/** 锚点 + 期望开向 + 尺寸 → 浮层该用的内联几何。纯函数：同一份输入永远同一份输出。 */
export function placeFloating(anchor: FloatingAnchor, opts: FloatingOptions = {}): FloatingPlacement {
  const side = opts.side ?? "bottom";
  const gap = opts.gap ?? GAP;
  const margin = opts.margin ?? MARGIN;
  const align = opts.align ?? "start";
  const alignOffset = opts.alignOffset ?? 0;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const vertical = side === "top" || side === "bottom";
  const pin = opts.size !== undefined;
  // 另一条轴上的尺寸：固定下来了就用它（对齐、收敛、写内联都用同一个数），否则用实测值。
  const cross = opts.size === "anchor" ? anchor.width : opts.size ?? opts.cross ?? 0;

  // near/far：请求的那条边、以及它的对面各剩多少。
  const near = side === "top" ? anchor.top - gap - margin
    : side === "bottom" ? vh - anchor.bottom - gap - margin
    : side === "left" ? anchor.left - gap - margin
    : vw - anchor.right - gap - margin;
  const far = side === "top" ? vh - anchor.bottom - gap - margin
    : side === "bottom" ? anchor.top - gap - margin
    : side === "left" ? vw - anchor.right - gap - margin
    : anchor.left - gap - margin;
  const inset = opts.inset ?? 0;
  // 装不装得下：竖开比内容高度估计，横开比要固定下来的那条宽（没固定就无从判定，不翻）。
  // 竖开时把内垫算进去——盒子高 = 内容高 + inset。
  const fit = vertical
    ? Math.min(opts.height ?? Infinity, opts.maxHeight ?? Infinity) + inset
    : (pin ? cross : 0);
  const out = near >= fit || far <= near ? side : OPPOSITE[side];
  const room = Math.max(0, out === side ? near : far);

  const style: CSSProperties = {
    position: "fixed",
    // 用不上的边显式写 auto：宿主类里的 `top: calc(100% + 4px)` 留着会和 bottom 双约束
    top: "auto",
    right: "auto",
    bottom: "auto",
    left: "auto",
    // 从"贴锚点的那一角"长出（参考实现的 transformOrigin 算法）。
    transformOrigin: vertical
      ? `${align} ${out === "top" ? "bottom" : "top"}`
      : `${out === "left" ? "right" : "left"} ${align}`,
  };

  if (vertical) {
    let left: number;
    if (align === "start") left = anchor.left + alignOffset;
    else if (align === "center") left = anchor.left + (anchor.width - cross) / 2 + alignOffset;
    else left = anchor.right - cross - alignOffset;
    style.left = Math.max(margin, cross === 0 ? left : Math.min(left, vw - cross - margin));
    // 限高按**内容盒**给：减掉宿主自己的内垫+边框，盒子总高才等于余量。
    style.maxHeight = Math.max(0, Math.min(room, opts.maxHeight ?? room) - inset);
    if (out === "top") style.bottom = vh - anchor.top + gap;
    else style.top = anchor.bottom + gap;
  } else {
    let top: number;
    if (align === "start") top = anchor.top + alignOffset;
    else if (align === "center") top = anchor.top + (anchor.height - cross) / 2 + alignOffset;
    else top = anchor.bottom - cross - alignOffset;
    style.top = Math.max(margin, cross === 0 ? top : Math.min(top, vh - cross - margin));
    // 竖向上剩下的空间就是限高（横开时另一条轴由内容和视口一起兜着）。
    style.maxHeight = vh - margin - (style.top as number);
    if (out === "left") style.right = vw - anchor.left + gap;
    else style.left = anchor.right + gap;
  }
  // 固定尺寸时连 min-width 一起钉住：宿主类里的 `min-width: 100%` 是按**包含块**算的，
  // portal 挂 body 后那个 100% 就是整屏宽，会把菜单撑成一条横贯全屏的带子。
  if (pin && cross > 0) style.width = style.minWidth = cross;
  return { style, side: out, axis: vertical ? "height" : "width" };
}
