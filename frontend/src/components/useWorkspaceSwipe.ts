// 侧栏工作区的手势横滑。
//
// ── 坐标（本文件唯一需要记住的事）──────────────────────────────────────────
// 横滑条是 flex 行，第 i 片占据 [i·W, (i+1)·W)（W = 条宽 = 一片宽）。整条的
// translateX(t) 平移一切，于是"第 i 片在屏幕上的位置 = i·W + t"。我们盯的只有一个
// 数：**t**。
//
//   往下一个（手指左划）：布局 [当前, 下一]，静止 t = 0；拖到 t = -W 时下一片满位。
//   往上一个（手指右划）：布局 [上一, 当前]，静止 t = -W；拖到 t = 0 时上一片满位。
//
// 切换发生的瞬间，两片的 **DOM 顺序必须保持不变**（角色互换而已：A 从"当前"变成
// "邻居"，B 反之），于是没有任何东西会横移；随后把 t 补到切换后的静止位：
//   往下一个 → t = -W（新片在 index 1）；往上一个 → t = 0（新片在 index 0）。
// 剩下的这段就是松手后的收尾动画，短而连续。**这就是"不跳"的全部秘密**——
// 早先几版在切换瞬间改静止位，让整条瞬移了一整片宽（224px），手感直接崩掉。
//
// ── 其余规则 ─────────────────────────────────────────────────────────────
//   · 内容全程 1:1 跟手（整片宽内无阻尼；超出后渐强橡皮筋），位移直写 transform
//     而不进 React state——每个 pointermove 都 setState 会重渲整份会话列表。
//   · 过半片宽就换空间，不等松手、不等触控板惯性尾巴（实测尾巴要发 1.4s）。
//     换完继续跟手：内容已经过去，视觉无断点。切换不可撤销，不看反向意图。
//   · 收尾动画期间输入不接管，否则惯性尾巴会把动画打断重跑。
//   · 到头不回绕；冷却防一次长滑连切。
import { useCallback, useEffect, useRef, useState } from "react";
import type { WheelEvent, PointerEvent as ReactPointerEvent } from "react";

/** arm 住目标所需的位移（松手确认时的辅助判据）。 */
const ARM_PX = 60;
/** 过半片宽即换空间（余下的路程交给收尾动画补齐）。 */
const COMMIT_AT = 0.5;
/** 手势停这么久就收尾（触控板惯性尾巴的判据）。 */
const SETTLE_MS = 110;
/** 切过一次后的冷却，防一次长滑连切。 */
const COOLDOWN_MS = 700;
/** 收尾过渡时长（须 ≥ CSS 的 --dur-med），到点撤邻居片、回静止态。 */
const SETTLE_TOTAL_MS = 240;

// ── 坐标决策（纯函数，单测盯着它们）────────────────────────────────────────
/** 切换**前**的静止位：下一片在右时 0（当前片在 index 0）；上一片在左时 -W。 */
export function restBefore(dir: number, w: number): number {
  return dir > 0 ? 0 : -w;
}
/** 切换**后**的静止位：新片成了 index 0 或 index 1，对应 t=0 或 t=-W——
 *  也就是"新片正好居中"。切换瞬间不改这个值（见文件头），所以不跳。 */
export function restAfterSwap(dir: number, w: number): number {
  return dir > 0 ? -w : 0;
}
/** 一片在屏幕上的 x：第 i 片 = i·W + t。i 由"邻居在左/右"与角色决定。 */
export function paneX(role: "active" | "neighbor", neighborLeft: boolean, t: number, w: number): number {
  const i = role === "active" ? (neighborLeft ? 1 : 0) : (neighborLeft ? 0 : 1);
  return i * w + t;
}

/** 跟手阻尼：**整片宽以内 1:1**，超出后渐强橡皮筋（斜率 0.15、封顶 1.2 片）。
 *  导出供单测：钉住"整片宽以内必须 1:1"——早先截在 160px（一片 224px），用户推到
 *  上限内容就不动了，看着像卡死。 */
export function damp(dx: number, pane: number): number {
  const a = Math.abs(dx);
  if (a <= pane) return dx;
  return Math.sign(dx) * (pane + Math.min(pane * 0.2, (a - pane) * 0.15));
}

export interface WorkspaceSwipe {
  /** 绑到 .ws-strip：手势期间本钩子直写它的 transform。 */
  stripRef: (el: HTMLDivElement | null) => void;
  /** 收尾中：这段时间开 CSS 过渡，且输入不接管。 */
  settling: boolean;
  /** 并排渲染的相邻空间下标（-1 = 没有）。拖动中=拖动方向上的邻居；换过之后
   *  = 换之前那个（收尾时它要跟着滑出视野）。 */
  neighbor: number;
  /** 相邻片是否排在当前片**左侧**（决定两片的渲染顺序）。 */
  neighborBefore: boolean;
  /** 手势进行中：给 CSS 关掉邻居片的入场动画（它会和 1:1 跟手形成双重运动）。 */
  dragging: boolean;
  wheel: (e: WheelEvent) => void;
  pointerDown: (e: ReactPointerEvent) => void;
  pointerMove: (e: ReactPointerEvent) => void;
  pointerUp: (e: ReactPointerEvent) => void;
}

// TEMP（取证用，量完删）：把各阶段时间点写进 engine.log，供壳侧读取。
let t0 = 0;
const marks: string[] = [];
function mark(what: string) {
  marks.push(`${what}@${(performance.now() - t0).toFixed(0)}`);
  if (marks.length > 20) marks.shift();
  try { void fetch("/__deepdive_error", { method: "POST", body: `[swipe] ${marks.join(" ")}` }); }
  catch { /* 取证通道，失败无所谓 */ }
}
function resetMarks() { t0 = performance.now(); marks.length = 0; mark("start"); }

export function useWorkspaceSwipe({ index, count, onCommit }: {
  /** 当前空间下标（-1 = 无）。 */
  index: number;
  count: number;
  onCommit: (nextIndex: number) => void;
}): WorkspaceSwipe {
  const [settling, setSettling] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** 拖动方向：+1 = 下一个在右侧，-1 = 上一个在左侧。收尾全程保留。 */
  const [dir, setDir] = useState(0);
  /** 本次手势中途已换过空间。 */
  const [swapped, setSwapped] = useState(false);
  const settlingRef = useRef(false);
  /** 手势进行中的全部状态（事件回调里读，不走 state）。 */
  const st = useRef({
    dir: 0, dragPx: 0, base: 0, switched: false,
    acc: 0, armed: 0, coolUntil: 0, settleTimer: 0, endTimer: 0,
  });
  const live = useRef({ startX: 0, startY: 0, locked: false, pointerId: -1 });
  const strip = useRef<HTMLDivElement | null>(null);
  const frame = useRef(0);
  const switchFrame = useRef(0);

  const enterSettling = useCallback((on: boolean) => {
    settlingRef.current = on;
    setSettling(on);
  }, []);

  const clearTimers = useCallback(() => {
    const s = st.current;
    if (s.settleTimer) { clearTimeout(s.settleTimer); s.settleTimer = 0; }
    if (s.endTimer) { clearTimeout(s.endTimer); s.endTimer = 0; }
  }, []);
  useEffect(() => clearTimers, [clearTimers]);
  useEffect(() => () => {
    if (frame.current) cancelAnimationFrame(frame.current);
    if (switchFrame.current) cancelAnimationFrame(switchFrame.current);
  }, []);

  const stripRef = useCallback((el: HTMLDivElement | null) => { strip.current = el; }, []);
  const paneWidth = useCallback(() => strip.current?.clientWidth ?? 240, []);

  const restAfter = restAfterSwap;

  const paint = useCallback(() => {
    frame.current = 0;
    const el = strip.current;
    if (!el) return;
    el.style.transform = `translateX(${st.current.base + st.current.dragPx}px)`;
  }, []);

  const schedulePaint = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(paint);
  }, [paint]);

  /** 换空间：延到"这一帧上屏之后"再发。主区那下是重活（整份会话视图卸载 + 新会话
   *  挂载），与拖动帧挤在一起会把手势卡住；延后一帧，此时内容已在位、无动画可卡。 */
  const fireSwitch = useCallback((target: number) => {
    if (switchFrame.current) return;
    switchFrame.current = requestAnimationFrame(() => {
      switchFrame.current = 0;
      window.setTimeout(() => { mark("switch"); onCommit(target); }, 0);
    });
  }, [onCommit]);

  /** 收尾：把 t 补到静止位（撤邻居片与行内 transform 都在过渡走完之后做，
   *  两者同帧发生、内容不产生位移）。 */
  const endGesture = useCallback(() => {
    if (settlingRef.current) return;
    mark("end");
    const s = st.current;
    live.current.pointerId = -1;
    s.acc = 0;
    s.armed = 0;
    setDragging(false);
    if (frame.current) { cancelAnimationFrame(frame.current); frame.current = 0; }
    if (s.switched) s.base = restAfter(s.dir, paneWidth());
    // 目标值与当前值相同就是"已在位"（一路拖到满位再松手），这时直接收，
    // 不必空跑一段 240ms 的过渡。
    const done = Math.abs(s.base + s.dragPx - s.base) < 1;
    s.dragPx = 0;
    if (done) {
      if (strip.current) strip.current.style.transform = `translateX(${s.base}px)`;
      finish();
      return;
    }
    if (strip.current) strip.current.style.transform = `translateX(${s.base}px)`;
    enterSettling(true);
    clearTimers();
    s.endTimer = window.setTimeout(finish, SETTLE_TOTAL_MS);

    function finish() {
      s.endTimer = 0;
      s.dir = 0;
      s.switched = false;
      s.base = 0;
      s.dragPx = 0;
      setDir(0);
      setSwapped(false);
      enterSettling(false);
      // 邻居片撤掉后只剩当前片，它在 index 0，行内 transform 也就该归零——
      // 与撤邻居同帧发生，屏幕上不会有任何位移。
      if (strip.current) strip.current.style.transform = "";
    }
  }, [clearTimers, enterSettling, paneWidth, restAfter]);

  /** 跟手途中刷新位移；过半片宽即换空间。 */
  const applyDrag = useCallback((dx: number) => {
    // **收尾动画期间输入不接管**（用户 2026-09-30 定："动画要独立完整"）。
    if (settlingRef.current) return;
    const s = st.current;
    if (s.settleTimer) { clearTimeout(s.settleTimer); s.settleTimer = 0; }
    s.acc = dx;
    if (Math.abs(dx) >= 4 && s.dir !== Math.sign(dx) * -1) {
      s.dir = Math.sign(dx) * -1;
      // 布局随方向定：下一片在右（[当前, 下一]、base 0），上一片在左
      // （[上一, 当前]、base -W）。顺序一换，静止位也要跟着换。
      s.base = restBefore(s.dir, paneWidth());
      if (!s.switched) setDir(s.dir);
      mark("dir");
    }
    if (Math.abs(dx) >= ARM_PX) s.armed = Math.sign(dx) * -1;
    s.dragPx = damp(dx, paneWidth());
    setDragging(true);
    schedulePaint();
    if (marks.length < 2) mark("drag");

    if (!s.switched && Math.abs(s.dragPx) >= paneWidth() * COMMIT_AT) {
      const target = index + s.dir;
      if (s.dir !== 0 && target >= 0 && target < count && performance.now() >= s.coolUntil) {
        s.switched = true;
        s.coolUntil = performance.now() + COOLDOWN_MS;
        setSwapped(true);
        mark(`swap->${target}`);
        fireSwitch(target);
      }
    }
  }, [count, fireSwitch, index, paneWidth, schedulePaint]);

  const neighbor = (() => {
    if (swapped) return dir > 0 ? index - 1 : index + 1;
    if (dir === 0 || count < 2) return -1;
    const n = index + dir;
    return n >= 0 && n < count ? n : -1;
  })();

  const wheel = useCallback((e: WheelEvent) => {
    if (count < 2 || settlingRef.current) return;
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const s = st.current;
    if (!s.acc) resetMarks();
    const cap = paneWidth() * 3;
    const next = Math.max(-cap, Math.min(cap, s.acc + e.deltaX));
    applyDrag(next);
    s.settleTimer = window.setTimeout(endGesture, SETTLE_MS);
  }, [applyDrag, count, endGesture, paneWidth]);

  const pointerDown = useCallback((e: ReactPointerEvent) => {
    if (count < 2 || e.button !== 0) return;
    resetMarks();
    // 不按落点元素过滤：会话行本身就是 button，而会话列表恰是最大的可拖区域——
    // 点按与拖动由轴锁定区分（没横移就是点按，行照常点开）。
    live.current = { startX: e.clientX, startY: e.clientY, locked: false, pointerId: e.pointerId };
  }, [count]);

  const pointerMove = useCallback((e: ReactPointerEvent) => {
    const l = live.current;
    if (l.pointerId !== e.pointerId) return;
    const dx = e.clientX - l.startX;
    const dy = e.clientY - l.startY;
    if (!l.locked) {
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
    endGesture();
  }, [endGesture]);

  return {
    stripRef, settling, neighbor,
    neighborBefore: swapped ? dir > 0 : dir < 0,
    dragging, wheel, pointerDown, pointerMove, pointerUp,
  };
}
