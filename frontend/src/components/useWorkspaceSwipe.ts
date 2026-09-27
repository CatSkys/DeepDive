// 侧栏工作区的手势横滑（用户定稿 2026-09-27：切换动画要跟手——触控板双指或
// 鼠标横向拖动推动内容，过阈值松手吸附到相邻空间；不再是"一滑就切、动画自放"）。
//
// 规则：
//   · 纵向手势不劫持（|deltaY| ≥ |deltaX| 直接放行，会话列表照常竖滚）；
//   · 拖动中内容 1:1 跟手（无 CSS 过渡），过 ARM_PX 阈值 arm 住相邻空间；继续推
//     继续跟（带阻尼上限），松手或手势停驻 SETTLE_MS 就结算：arm 住 → 切空间，
//     新内容从松手处接着滑入（enterFrom）；没 arm → 回弹；
//   · 到头不回绕；COOLDOWN_MS 冷却防一次长滑连切（冷却期内的手势只橡皮筋回弹）。
import { useCallback, useEffect, useRef, useState } from "react";
import type { WheelEvent, PointerEvent as ReactPointerEvent } from "react";

/** 与原实现同阈：横向累计过这个位移就 arm 住目标。 */
const ARM_PX = 60;
/** 跟手上限：再推也不让内容飞出面板太远（阻尼区从 ARM_PX 开始）。 */
const MAX_PX = 160;
/** 手势停这么久就结算（触控板惯性尾巴的判据）。 */
const SETTLE_MS = 140;
/** 切过一次后的冷却，防一次长滑连切。 */
const COOLDOWN_MS = 700;
/** 切完后清 enterFrom 的等待（略长于入场动画）。 */
const ENTER_CLEAR_MS = 320;

export interface WorkspaceSwipe {
  /** 当前拖动位移（px）：写进侧栏的 --ws-drag，拖动中 1:1 跟手。 */
  drag: number;
  /** 结算中（回弹/吸附的过渡态）：这段时间开 CSS 过渡。 */
  settling: boolean;
  /** 手势切换后新视图的入场起点（px，带方向）；null = 非手势切换，走默认入场。 */
  enterFrom: number | null;
  wheel: (e: WheelEvent) => void;
  pointerDown: (e: ReactPointerEvent) => void;
  pointerMove: (e: ReactPointerEvent) => void;
  pointerUp: (e: ReactPointerEvent) => void;
  /** 任何新手势开始时把入场起点清掉（否则下次程序化切换会沿用旧起点）。 */
  resetEnter: () => void;
}

/** 阻尼：ARM_PX 之前线性，之后按 0.45 斜率到 MAX_PX——推过头阻力变大，像真的橡皮筋。 */
function damp(dx: number): number {
  const s = Math.sign(dx);
  const a = Math.abs(dx);
  if (a <= ARM_PX) return dx;
  return s * Math.min(MAX_PX, ARM_PX + (a - ARM_PX) * 0.45);
}

export function useWorkspaceSwipe({ index, count, onCommit }: {
  /** 当前空间在 store.workspaces 里的下标（-1 = 无）。 */
  index: number;
  count: number;
  onCommit: (nextIndex: number) => void;
}): WorkspaceSwipe {
  const [drag, setDrag] = useState(0);
  const [settling, setSettling] = useState(false);
  const [enterFrom, setEnterFrom] = useState<number | null>(null);
  const st = useRef({ armed: 0, acc: 0, coolUntil: 0, settleTimer: 0, clearTimer: 0 });
  // 手势进行中的实时值（事件回调里读，不走 state）：arm 方向、起点、轴锁定
  const live = useRef({ startX: 0, startY: 0, locked: false, dragging: false, pointerId: -1 });

  const clearTimers = useCallback(() => {
    const s = st.current;
    if (s.settleTimer) { clearTimeout(s.settleTimer); s.settleTimer = 0; }
    if (s.clearTimer) { clearTimeout(s.clearTimer); s.clearTimer = 0; }
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const resetEnter = useCallback(() => {
    const s = st.current;
    if (s.clearTimer) { clearTimeout(s.clearTimer); s.clearTimer = 0; }
    setEnterFrom(null);
  }, []);

  /** 结算：arm 住且冷却已过 → 切空间并把松手位移交给入场动画；否则回弹。
   *  轮盘路径由停驻定时器调、拖拽路径由松手直接调——两条都要能进来（早退只清定时器）。 */
  const settle = useCallback(() => {
    const s = st.current;
    if (s.settleTimer) { clearTimeout(s.settleTimer); s.settleTimer = 0; }
    // 入场起点取"释放时屏幕上真实停在哪"（阻尼后的值），动画才接得上
    const released = live.current.dragging ? damp(s.acc) : 0;
    setDrag(0);
    live.current.dragging = false;
    const now = performance.now();
    const dir = s.armed;
    if (dir !== 0 && count > 1 && now >= s.coolUntil) {
      const target = index + dir;
      if (target >= 0 && target < count) {
        s.armed = 0;
        s.acc = 0;
        s.coolUntil = now + COOLDOWN_MS;
        setEnterFrom(released);
        s.clearTimer = window.setTimeout(() => setEnterFrom(null), ENTER_CLEAR_MS);
        onCommit(target);
        return;
      }
    }
    s.armed = 0;
    s.acc = 0;
    // 回弹：开一段过渡归零
    setSettling(true);
    window.setTimeout(() => setSettling(false), 260);
  }, [count, index, onCommit]);

  const wheel = useCallback((e: WheelEvent) => {
    if (count < 2) return;
    // 纵向占优 = 用户在滚会话列表，放行
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const s = st.current;
    if (s.settleTimer) { clearTimeout(s.settleTimer); s.settleTimer = 0; }
    setSettling(false);
    resetEnter();
    s.acc = Math.max(-MAX_PX * 2, Math.min(MAX_PX * 2, s.acc + e.deltaX));
    live.current.dragging = true;
    setDrag(damp(s.acc));
    if (Math.abs(s.acc) >= ARM_PX) s.armed = s.acc > 0 ? 1 : -1;
    s.settleTimer = window.setTimeout(settle, SETTLE_MS);
  }, [count, resetEnter, settle]);

  const pointerDown = useCallback((e: ReactPointerEvent) => {
    if (count < 2 || e.button !== 0) return;
    // 不按落点元素过滤：会话行本身就是 button，而会话列表恰是最大的可拖区域——
    // 点按与拖动由轴锁定区分（没横移就是点按，行照常点开），按落点拒手势会让
    // 用户在列表上怎么划都没反应。
    live.current = { startX: e.clientX, startY: e.clientY, locked: false, dragging: false, pointerId: e.pointerId };
  }, [count]);

  const pointerMove = useCallback((e: ReactPointerEvent) => {
    const l = live.current;
    if (l.pointerId !== e.pointerId) return;
    const dx = e.clientX - l.startX;
    const dy = e.clientY - l.startY;
    if (!l.locked) {
      // 轴锁定：先判方向，竖向直接放弃（列表滚动照旧），横向才接管
      if (Math.abs(dy) > 6 && Math.abs(dy) >= Math.abs(dx)) { l.pointerId = -1; return; }
      if (Math.abs(dx) < 6) return;
      l.locked = true;
      l.dragging = true;
      resetEnter();
      try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* 捕获失败不致命 */ }
    }
    const s = st.current;
    if (s.settleTimer) { clearTimeout(s.settleTimer); s.settleTimer = 0; }
    setSettling(false);
    s.acc = dx;
    setDrag(damp(dx));
    if (Math.abs(dx) >= ARM_PX) s.armed = dx > 0 ? -1 : 1;
  }, [resetEnter]);

  const pointerUp = useCallback((e: ReactPointerEvent) => {
    const l = live.current;
    if (l.pointerId !== e.pointerId) return;
    l.pointerId = -1;
    if (!l.locked) return;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* 已经放掉 */ }
    settle();
  }, [settle]);

  return { drag, settling, enterFrom, wheel, pointerDown, pointerMove, pointerUp, resetEnter };
}
