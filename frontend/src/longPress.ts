import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

// 触屏长按 → 与右键同一张菜单。
//
// 为什么需要：手机浏览器里没有右键，iOS Safari 长按也不给普通元素派发
// contextmenu——只挂在 onContextMenu 上的动作（会话行的归档/删除/复制 ID、
// 工作区的重命名/移除）在手机上一个都进不去。
//
// 只在 pointerType === "touch" 时接管：鼠标/触控板照旧走 onContextMenu，
// 桌面行为一字不变。移动超过阈值（在滚动）或抬手/取消都收回，避免滚动误弹。
// 长按弹出后要吃掉紧随其后的 click——否则菜单弹出的同时还会把会话打开。

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 8;

// 同一时刻只可能有一根手指按着，所以这套状态放模块级即可（不必每行一个 ref，
// 会话行是 map 出来的，行内放不下 hook）。
let timer: number | null = null;
let originX = 0;
let originY = 0;
let suppressNextClick = false;

function clearTimer() {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
}

/** 展开到元素上：`<button {...longPressHandlers((x, y) => openMenu(x, y))}>`。
 *  与同一元素的 onContextMenu 共用同一个打开函数。 */
export function longPressHandlers(onLongPress: (x: number, y: number) => void) {
  return {
    onPointerDown(e: ReactPointerEvent) {
      if (e.pointerType !== "touch") return;
      originX = e.clientX;
      originY = e.clientY;
      clearTimer();
      timer = window.setTimeout(() => {
        timer = null;
        suppressNextClick = true;
        onLongPress(originX, originY);
      }, LONG_PRESS_MS);
    },
    onPointerMove(e: ReactPointerEvent) {
      if (timer === null) return;
      if (Math.abs(e.clientX - originX) > MOVE_TOLERANCE_PX || Math.abs(e.clientY - originY) > MOVE_TOLERANCE_PX) {
        clearTimer();
      }
    },
    onPointerUp: clearTimer,
    onPointerCancel: clearTimer,
    onClickCapture(e: ReactMouseEvent) {
      if (!suppressNextClick) return;
      suppressNextClick = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
