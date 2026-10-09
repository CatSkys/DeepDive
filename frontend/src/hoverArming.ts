// 悬停点亮（hover arming）：行与菜单项的 hover 只响应「指针主动移动过来」，绝不
// 因为指针恰好停在那里就点亮——列表滚动、内容重排、浮层在静止指针下打开时，滑到
// 指针底下的那一行都不该亮（那是「按位置点亮」，最像网页的一处）。
//
// 机制侧只写一个根属性 data-hover-armed，样式侧由 theme.css 的
// `:where(html[data-hover-armed])` 门控，所以复位时 CSS 自己就把已亮的行熄掉，
// 不需要 React 重渲染。纯状态机与 DOM 接线分开，前者可单测（见 __tests__）。
// 接线：main.tsx 的 installHoverArming() + useHoverArming.ts（换视图复位）。

import { DD_EVENTS, onAppEvent } from "./events";

export interface HoverArmingState {
  armed: boolean;
  /** 上一次「指针自己动过」的位置；null = 还没见过 pointermove。 */
  anchor: { x: number; y: number } | null;
}

/** 抖动容差（pt）：滚轮点一下会让鼠标挪一两个像素，手势结束时 AppKit/WebKit 还会
 *  补一个零位移的 pointermove——不到这个距离都不算「动过」。 */
export const HOVER_SLOP = 3;

export function initialHoverArming(): HoverArmingState {
  return { armed: false, anchor: null };
}

/** 指针移动。还没立锚点时只立锚点（页面在静止指针下打开：那次移动只是告诉我们
 *  指针在哪，不是「选了这里」）；锚点此后不动，所以一像素一像素地蹭也会累积。 */
export function pointerMoved(state: HoverArmingState, x: number, y: number): HoverArmingState {
  if (state.armed) return state;
  if (state.anchor === null) return { armed: false, anchor: { x, y } };
  if (Math.hypot(x - state.anchor.x, y - state.anchor.y) <= HOVER_SLOP) return state;
  return { armed: true, anchor: state.anchor };
}

/** 复位。锚点落在指针当下所在（`at` 为空则保持不动）：此后必须真的移动才算数，
 *  滚动时手在滚轮上的抖动永远累积不起来。 */
export function hoverDisarmed(
  state: HoverArmingState,
  at: { x: number; y: number } | null
): HoverArmingState {
  return { armed: false, anchor: at ?? state.anchor };
}

let current = initialHoverArming();
let lastPointer: { x: number; y: number } | null = null;

function apply(next: HoverArmingState): void {
  const flipped = next.armed !== current.armed;
  current = next;
  if (!flipped) return;
  if (next.armed) document.documentElement.dataset.hoverArmed = "";
  else delete document.documentElement.dataset.hoverArmed;
}

/** 指针移动 → 可能点亮。 */
export function notePointerMoved(x: number, y: number): void {
  lastPointer = { x, y };
  apply(pointerMoved(current, x, y));
}

/** 复位时机：换视图（换会话/换空间/开关设置浮层）、滚动、浮层在静止指针下打开。
 *  从任意一处调用即可，重复调用是幂等的（已复位时不动 DOM）。 */
export function disarmHoverArming(): void {
  apply(hoverDisarmed(current, lastPointer));
}

/** 装全局监听：pointermove 点亮，scroll 复位（列表在静止指针下换了身份——含流式
 *  输出钉在底部时的每一次自动滚动），⌘K 命令面板打开也复位（浮层在静止指针下出现，
 *  那一行同样不是指针选的）。首帧先复位，所以页面打开时停在行上的指针不亮。
 *  换会话/换空间/开关设置浮层的复位在 useHoverArming.ts（那三样是 React 状态）。 */
export function installHoverArming(): () => void {
  const onMove = (e: PointerEvent) => notePointerMoved(e.clientX, e.clientY);
  const onScroll = () => disarmHoverArming();
  const offPalette = onAppEvent(DD_EVENTS.commandPalette, disarmHoverArming);

  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("scroll", onScroll, { capture: true, passive: true });
  disarmHoverArming();

  return () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("scroll", onScroll, { capture: true });
    offPalette();
  };
}
