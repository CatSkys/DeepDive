// 侧栏工作区的手势横滑（用户定稿 2026-09-27：切换动画要跟手——触控板双指或
// 鼠标横向拖动推动内容，过阈值松手吸附到相邻空间；不再是"一滑就切、动画自放"）。
//
// 规则：
//   · 纵向手势不劫持（|deltaY| ≥ |deltaX| 直接放行，会话列表照常竖滚）；
//   · 拖动中内容 1:1 跟手（无 CSS 过渡），过 ARM_PX 阈值 arm 住相邻空间；继续推
//     继续跟（带阻尼上限），松手或手势停驻 SETTLE_MS 就结算：arm 住 → 切空间，
//     否则回弹；
//   · **拖动中就把相邻空间渲染出来**（neighbor），两片并排、整条一起平移——滑动
//     过程中下一空间就在眼前，不靠"切完再滑入"补戏（用户定稿：无缝衔接）；
//   · 到头不回绕；COOLDOWN_MS 冷却防一次长滑连切。
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
/** 吸附到底（把整条滑到边缘）再换空间。必须 ≥ CSS 的 --dur-med，否则 swap
 *  在动画走完前发生，strip 提前归零而新片还没到位——中间那一帧会跳。 */
const COMMIT_MS = 210;

/** 结算落点：next=滑到左边缘（下一空间顶上），prev=滑到右边缘。 */
export type SwipeCommit = "next" | "prev" | null;

export interface WorkspaceSwipe {
  /** 当前拖动位移（px）：写进侧栏的 --ws-drag，拖动中 1:1 跟手。 */
  drag: number;
  /** 结算中（回弹/吸附的过渡态）：这段时间开 CSS 过渡。 */
  settling: boolean;
  /** 结算落点；null=不在结算。CSS 据此把整条滑到边缘。 */
  commit: SwipeCommit;
  /** 拖动方向上的相邻空间下标（-1 = 没有：方向朝外或没在拖）。渲染它才能无缝。 */
  neighbor: number;
  wheel: (e: WheelEvent) => void;
  pointerDown: (e: ReactPointerEvent) => void;
  pointerMove: (e: ReactPointerEvent) => void;
  pointerUp: (e: ReactPointerEvent) => void;
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
  const [commit, setCommit] = useState<SwipeCommit>(null);
  /** 拖动方向（+1 = 下一空间在右侧 / -1 = 上一空间在左侧）。**结算全程保留**：
   *  归零之后那一瞬若把邻居撤掉，边缘会闪一下——它得跟着一路滑出视野。 */
  const [lastDir, setLastDir] = useState(0);
  const st = useRef({ armed: 0, acc: 0, coolUntil: 0, settleTimer: 0, swapTimer: 0, dir: 0 });
  // 手势进行中的实时值（事件回调里读，不走 state）：起点与轴锁定
  const live = useRef({ startX: 0, startY: 0, locked: false, pointerId: -1 });

  const clearTimers = useCallback(() => {
    const s = st.current;
    if (s.settleTimer) { clearTimeout(s.settleTimer); s.settleTimer = 0; }
    if (s.swapTimer) { clearTimeout(s.swapTimer); s.swapTimer = 0; }
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  /** 方向（下一空间在右侧=+1）→ 邻居下标，越界或没方向就没有（-1）。 */
  const neighbor = (() => {
    if (lastDir === 0 || count < 2) return -1;
    const n = index + lastDir;
    return n >= 0 && n < count ? n : -1;
  })();

  /** 跟手途中刷新位移与方向。settle 里也调：切空间后 arm/acc 要归零，
   *  方向保留到结算结束（否则边缘会闪）。 */
  const applyDrag = useCallback((dx: number) => {
    const s = st.current;
    if (s.settleTimer) { clearTimeout(s.settleTimer); s.settleTimer = 0; }
    setSettling(false);
    s.acc = dx;
    // 内容左移（dx<0）露出右侧的下一个 → dir=+1。wheel 与 pointer 同一口径：
    // 早先两条路径一个取 +1 一个取 -1，触控板与鼠标往相反方向切，是 bug。
    if (Math.abs(dx) >= 4 && s.dir !== Math.sign(dx) * -1) {
      s.dir = Math.sign(dx) * -1;
      setLastDir(s.dir);
    }
    if (Math.abs(dx) >= ARM_PX) s.armed = Math.sign(dx) * -1;
    setDrag(damp(dx));
  }, []);

  /** 结算：arm 住且冷却已过 → 先把整条滑到边缘，动画走完再换空间（无缝）；
   *  否则回弹。轮盘路径由停驻定时器调、拖拽路径由松手直接调——两条都要能进来。 */
  const settle = useCallback(() => {
    const s = st.current;
    if (s.settleTimer) { clearTimeout(s.settleTimer); s.settleTimer = 0; }
    live.current.pointerId = -1;
    const now = performance.now();
    const dir = s.armed;
    s.armed = 0;
    s.acc = 0;
    if (dir !== 0 && count > 1 && now >= s.coolUntil) {
      const target = index + dir;
      if (target >= 0 && target < count) {
        s.coolUntil = now + COOLDOWN_MS;
        setCommit(dir > 0 ? "next" : "prev");
        setSettling(true);
        // 滑到边缘再换：换的瞬间整条归零，而顶上来的那片正好在原位，视觉无跳变。
        clearTimers();
        s.swapTimer = window.setTimeout(() => {
          s.swapTimer = 0;
          s.dir = 0;
          setCommit(null);
          setDrag(0);
          setLastDir(0);
          setSettling(false);
          onCommit(target);
        }, COMMIT_MS);
        return;
      }
    }
    // 回弹：开一段过渡归零，邻居跟着滑出视野
    setSettling(true);
    clearTimers();
    s.swapTimer = window.setTimeout(() => {
      s.swapTimer = 0;
      s.dir = 0;
      setDrag(0);
      setLastDir(0);
      setSettling(false);
    }, 260);
  }, [clearTimers, count, index, onCommit]);

  const wheel = useCallback((e: WheelEvent) => {
    if (count < 2) return;
    // 纵向占优 = 用户在滚会话列表，放行
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const s = st.current;
    const next = Math.max(-MAX_PX * 2, Math.min(MAX_PX * 2, s.acc + e.deltaX));
    applyDrag(next);
    s.settleTimer = window.setTimeout(settle, SETTLE_MS);
  }, [applyDrag, count, settle]);

  const pointerDown = useCallback((e: ReactPointerEvent) => {
    if (count < 2 || e.button !== 0) return;
    // 不按落点元素过滤：会话行本身就是 button，而会话列表恰是最大的可拖区域——
    // 点按与拖动由轴锁定区分（没横移就是点按，行照常点开），按落点拒手势会让
    // 用户在列表上怎么划都没反应。
    live.current = { startX: e.clientX, startY: e.clientY, locked: false, pointerId: e.pointerId };
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
      try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* 捕获失败不致命 */ }
    }
    applyDrag(dx);
  }, [applyDrag]);

  const pointerUp = useCallback((e: ReactPointerEvent) => {
    const l = live.current;
    if (l.pointerId !== e.pointerId) return;
    if (!l.locked) { l.pointerId = -1; return; }
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* 已经放掉 */ }
    settle();
  }, [settle]);

  return { drag, settling, commit, neighbor, wheel, pointerDown, pointerMove, pointerUp };
}
