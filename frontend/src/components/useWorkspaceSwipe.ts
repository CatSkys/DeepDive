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
//   · **上一空间在左、下一空间在右**（`data-order`）：早先两片都排在右边，于是
//     往回切时"上一个"其实在右侧——无论往哪滑动画方向都一样，看着像方向反了
//     （2026-09-30 用户报）。方向由 lastDir 决定渲染顺序与静止位。
//   · 到头不回绕；COOLDOWN_MS 冷却防一次长滑连切。
//
// **位移不进 React state**：每个 pointermove 都 setState 会重渲整份会话列表，
// 手势直接被拖成幻灯片（2026-09-30 用户报"整体不那么丝滑"）。整条的 transform
// 由手势直写元素（rAF 合并，一帧一次），React 只管低频的结算态与邻居渲染。
//
// **行内 transform 不能同步撤**：结算时行内值优先级高于样式表，撤掉才轮得到
// data-commit 的吸附动画；但同步撤会让条子先弹回静止位再滑过去。隔一帧撤，
// 浏览器才认得下过渡的起点。
import { useCallback, useEffect, useRef, useState } from "react";
import type { WheelEvent, PointerEvent as ReactPointerEvent } from "react";

/** 与原实现同阈：横向累计过这个位移就 arm 住目标。 */
const ARM_PX = 60;
/** 手势停这么久就结算（触控板惯性尾巴的判据）。 */
const SETTLE_MS = 140;
/** 切过一次后的冷却，防一次长滑连切。 */
const COOLDOWN_MS = 700;
/** 吸附到位的兜底时长：正常由 transitionend 触发换空间，这个只防"过渡没跑"
 *  （比如剩余路程为 0、或 prefers-reduced-motion 关掉了过渡）。 */
const COMMIT_MS = 320;

/** 结算落点：next=滑到左边缘（下一空间顶上），prev=滑到右边缘。 */
export type SwipeCommit = "next" | "prev" | null;

export interface WorkspaceSwipe {
  /** 绑到 .ws-strip：手势期间本钩子直写它的 transform。 */
  stripRef: (el: HTMLDivElement | null) => void;
  /** 结算中（回弹/吸附的过渡态）：这段时间开 CSS 过渡。 */
  settling: boolean;
  /** 结算落点；null=不在结算。CSS 据此把整条滑到边缘。 */
  commit: SwipeCommit;
  /** 拖动方向上的相邻空间下标（-1 = 没有：方向朝外或没在拖）。渲染它才能无缝。 */
  neighbor: number;
  /** 拖动方向（+1 = 下一空间在右侧 / -1 = 上一空间在左侧）。决定两片的渲染顺序。 */
  dir: number;
  /** 手势进行中：给 CSS 关掉邻居片的入场动画（它会和 1:1 跟手形成双重运动）。 */
  dragging: boolean;
  wheel: (e: WheelEvent) => void;
  pointerDown: (e: ReactPointerEvent) => void;
  pointerMove: (e: ReactPointerEvent) => void;
  pointerUp: (e: ReactPointerEvent) => void;
}

/** 跟手上限：整片宽 + 一点橡皮筋余量。**不能小于一片宽**——早先截在 160px
 *  （一片 224px），推到上限内容就不动了，用户看着像卡死（2026-09-30 用户报）。 */
const MAX_PX = 420;
/** 超出整片宽之后的橡皮筋斜率。 */
const RUBBER = 0.3;

/** 跟手阻尼：**整片宽以内 1:1**（一片一片地推出去，推满即整片换到眼前），
 *  超出才加阻力并封顶——像真的橡皮筋，而不是"推不动了"。
 *  导出供单测：上限早先截在 160px（一片 224px），推到上限内容就停住，用户看着
 *  像卡死——这条正是要钉住的不变量。 */
export function damp(dx: number, pane: number): number {
  const a = Math.abs(dx);
  if (a <= pane) return dx;
  return Math.sign(dx) * (pane + Math.min(pane * 0.2, (a - pane) * RUBBER));
}

export function useWorkspaceSwipe({ index, count, onCommit }: {
  /** 当前空间在 store.workspaces 里的下标（-1 = 无）。 */
  index: number;
  count: number;
  onCommit: (nextIndex: number) => void;
}): WorkspaceSwipe {
  const [settling, setSettling] = useState(false);
  const [commit, setCommit] = useState<SwipeCommit>(null);
  const [dragging, setDragging] = useState(false);
  /** 拖动方向（+1 = 下一空间在右侧 / -1 = 上一空间在左侧）。**结算全程保留**：
   *  归零之后那一瞬若把邻居撤掉，边缘会闪一下——它得跟着一路滑出视野。 */
  const [lastDir, setLastDir] = useState(0);
  const st = useRef({ armed: 0, acc: 0, coolUntil: 0, settleTimer: 0, swapTimer: 0, dir: 0 });
  // 手势进行中的实时值（事件回调里读，不走 state）：起点与轴锁定
  const live = useRef({ startX: 0, startY: 0, locked: false, pointerId: -1 });
  // 跟手位移：直写 transform，不进 state（见文件头）
  const strip = useRef<HTMLDivElement | null>(null);
  const dragPx = useRef(0);
  const frame = useRef(0);
  /** 结算时"撤掉行内 transform"的待执行帧：必须隔一帧，不能同步撤。 */
  const releaseFrame = useRef(0);
  /** 已 arm、等着"吸附动画结束就换"的目标下标；null=没有待换的。 */
  const pendingSwap = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    const s = st.current;
    if (s.settleTimer) { clearTimeout(s.settleTimer); s.settleTimer = 0; }
    if (s.swapTimer) { clearTimeout(s.swapTimer); s.swapTimer = 0; }
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  /** 静止位：上一空间在左侧时整条停在 -100%（当前片在右、邻居在左）。 */
  const restShift = (d: number) => (d < 0 ? "-100%" : "0px");

  const paint = useCallback(() => {
    frame.current = 0;
    const el = strip.current;
    if (!el) return;
    const rest = restShift(st.current.dir);
    el.style.transform = rest === "0px"
      ? `translateX(${dragPx.current}px)`
      : `translateX(${rest}) translateX(${dragPx.current}px)`;
  }, []);

  /** 一片有多宽：跟手要按它 1:1 走满，所以每次都量当前值（侧栏可拖宽）。 */
  const paneWidth = useCallback(() => strip.current?.clientWidth ?? 240, []);

  /** 一帧只写一次：触控板事件比帧还密。 */
  const schedulePaint = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(paint);
  }, [paint]);

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
    // 手势重新开始：把上一轮待撤的帧撤掉，否则它会在拖动中途把行内值抹掉。
    if (releaseFrame.current) { cancelAnimationFrame(releaseFrame.current); releaseFrame.current = 0; }
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
    dragPx.current = damp(dx, paneWidth());
    setDragging(true);
    schedulePaint();
  }, [paneWidth, schedulePaint]);

  /** 结算：arm 住且冷却已过 → 先把整条滑到边缘，动画走完再换空间（无缝）；
   *  否则回弹。轮盘路径由停驻定时器调、拖拽路径由松手直接调——两条都要能进来。
   *  进入结算就把行内 transform 撤掉，交给 CSS 的 data-commit + 过渡接手
   *  （行内样式优先级高于样式表，不撤就永远看不到吸附动画）。 */
  /** 换空间本体：撤掉结算态、换 active。抽出来是为了 transitionend 与兜底定时器
   *  走同一条路（早先两处各写一份，漏改过一次）。 */
  const swapTo = useCallback((target: number) => {
    const s = st.current;
    if (s.swapTimer) { clearTimeout(s.swapTimer); s.swapTimer = 0; }
    s.dir = 0;
    pendingSwap.current = null;
    setCommit(null);
    setLastDir(0);
    setSettling(false);
    onCommit(target);
  }, [onCommit]);

  const swapRef = useRef(swapTo);
  swapRef.current = swapTo;

  /** 吸附动画一结束就换空间——不等固定时长。定时器只在过渡没触发时兜底
   *  （推满整片时剩余路程为 0，过渡根本不会开始）。 */
  const onTransitionEnd = useCallback((e: TransitionEvent) => {
    if (e.target !== strip.current || e.propertyName !== "transform") return;
    const target = pendingSwap.current;
    if (target === null) return;
    swapRef.current(target);
  }, []);

  const stripRef = useCallback((el: HTMLDivElement | null) => {
    strip.current?.removeEventListener("transitionend", onTransitionEnd);
    strip.current = el;
    el?.addEventListener("transitionend", onTransitionEnd);
  }, [onTransitionEnd]);

  /** 结算：arm 住且冷却已过 → 先把整条滑到边缘，动画走完（或推满即止）再换空间；
   *  否则回弹。轮盘路径由停驻定时器调、拖拽路径由松手直接调——两条都要能进来。
   *  进入结算就把行内 transform 隔帧撤掉，交给 CSS 的 data-commit + 过渡接手
   *  （行内样式优先级高于样式表，不撤就永远看不到吸附动画）。 */
  const settle = useCallback(() => {
    const s = st.current;
    if (s.settleTimer) { clearTimeout(s.settleTimer); s.settleTimer = 0; }
    live.current.pointerId = -1;
    const now = performance.now();
    const dir = s.armed;
    const held = Math.abs(dragPx.current);
    s.armed = 0;
    s.acc = 0;
    setDragging(false);
    if (frame.current) { cancelAnimationFrame(frame.current); frame.current = 0; }
    dragPx.current = 0;
    // **隔一帧再撤行内 transform**：同步撤的话，条子会先从拖到的位置弹回静止位
    // （整片宽的一跳）才开始吸附动画。隔一帧，浏览器先把行内值记成过渡的起点
    //（此时 data-settling 的 transition 已生效），撤掉后从拖到的位置平滑滑到落点。
    if (releaseFrame.current) cancelAnimationFrame(releaseFrame.current);
    releaseFrame.current = requestAnimationFrame(() => {
      releaseFrame.current = 0;
      if (strip.current) strip.current.style.transform = "";
    });
    if (dir !== 0 && count > 1 && now >= s.coolUntil) {
      const target = index + dir;
      if (target >= 0 && target < count) {
        s.coolUntil = now + COOLDOWN_MS;
        // 正好推满整片：邻居片已在眼前，没什么可滑的——直接换，别让"吸附动画"
        // 变成一段没有内容可动的等待（用户报"滑到尽头卡好一会"）。推过头（橡皮筋
        // 余量）不行：那截得先平滑收回去，不能硬拉。
        if (Math.abs(held - paneWidth()) < 2) {
          swapTo(target);
          return;
        }
        setCommit(dir > 0 ? "next" : "prev");
        setSettling(true);
        // 滑到边缘再换：换的瞬间整条归零，而顶上来的那片正好在原位，视觉无跳变。
        clearTimers();
        pendingSwap.current = target;
        s.swapTimer = window.setTimeout(() => swapTo(target), COMMIT_MS);
        return;
      }
    }
    // 回弹：开一段过渡归零，邻居跟着滑出视野
    setSettling(true);
    clearTimers();
    s.swapTimer = window.setTimeout(() => {
      s.swapTimer = 0;
      s.dir = 0;
      setLastDir(0);
      setSettling(false);
    }, 260);
  }, [clearTimers, count, index, paneWidth, swapTo]);

  const wheel = useCallback((e: WheelEvent) => {
    if (count < 2) return;
    // 纵向占优 = 用户在滚会话列表，放行
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const s = st.current;
    const next = Math.max(-MAX_PX, Math.min(MAX_PX, s.acc + e.deltaX));
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

  return { stripRef, settling, commit, neighbor, dir: lastDir, dragging, wheel, pointerDown, pointerMove, pointerUp };
}
