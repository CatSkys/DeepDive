// 侧栏工作区的手势横滑。
//
// 交互模型（2026-09-30 按用户反馈定稿，前前后后换了三版才对上）：
//   · **内容全程跟手**：横向位移 1:1 直写 transform（不进 React state——每个
//     pointermove 都 setState 会重渲整份会话列表，手势会被拖成幻灯片）；
//     整片宽以内 1:1，超出后是渐强橡皮筋。上一空间在左、下一空间在右。
//   · **拖动中就把相邻空间渲染出来**，两片并排、整条一起平移（无缝衔接）。
//   · **到位即换**：内容走到 0.85 片宽（= 基本已经滑过去）就换空间，**不等松手、
//     不等触控板惯性尾巴**。实测惯性尾巴要发 1.4s，等它就是用户感受到的"卡住"。
//     换完之后继续跟手——内容已经到位，视觉上毫无断点。
//   · **换完不再回头**：换空间不可撤销（store 层面就没有"换回去"这回事），所以
//     越过提交点后不再理会反向意图。
//   · **手势停了才收尾**：把行内 transform 隔帧撤掉，交给 CSS 过渡弹回静止位；
//     收尾期间"换之前那个空间"继续挂在左侧，随条子一起滑出视野。
//   · **结算动画期间输入不接管**：否则触控板惯性尾巴会把动画打断在半路、重新
//     触发一遍（用户报"松手后动画还要再跑一遍"）。
//   · 到头不回绕；冷却防一次长滑连切。
import { useCallback, useEffect, useRef, useState } from "react";
import type { WheelEvent, PointerEvent as ReactPointerEvent } from "react";

/** 过这条线就 arm 住目标（松手时确认切换的判据之一）。 */
const ARM_PX = 60;
/** **提交点**：横向走到片宽的这个比例就换空间，不等手势结束。 */
const COMMIT_AT = 0.85;
/** 手势停这么久就收尾（触控板惯性尾巴的判据）。 */
const SETTLE_MS = 110;
/** 切过一次后的冷却，防一次长滑连切。 */
const COOLDOWN_MS = 700;
/** 收尾过渡时长（须 ≥ CSS 的 --dur-med），到点撤邻居片。 */
const SETTLE_MS_TOTAL = 240;

/** 跟手阻尼：**整片宽以内 1:1**，超出后渐强橡皮筋（斜率 0.15、封顶 1.2 片）。
 *  导出供单测：钉住"整片宽以内必须 1:1"这条不变量——早先截在 160px（一片 224px），
 *  用户推到上限内容就不动了，看着像卡死。 */
export function damp(dx: number, pane: number): number {
  const a = Math.abs(dx);
  if (a <= pane) return dx;
  return Math.sign(dx) * (pane + Math.min(pane * 0.2, (a - pane) * 0.15));
}

export interface WorkspaceSwipe {
  /** 绑到 .ws-strip：手势期间本钩子直写它的 transform。 */
  stripRef: (el: HTMLDivElement | null) => void;
  /** 收尾中（弹回静止位的过渡态）：这段时间开 CSS 过渡，且输入不接管。 */
  settling: boolean;
  /** 并排渲染的相邻空间下标（-1 = 没有）。拖动中=拖动方向上的邻居；换过之后
   *  = 换之前那个（收尾时它要跟着滑出视野）。 */
  neighbor: number;
  /** 相邻片是否排在当前片**左侧**。 */
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
  const now = performance.now();
  marks.push(`${what}@${(now - t0).toFixed(0)}`);
  if (marks.length > 20) marks.shift();
  try { void fetch("/__deepdive_error", { method: "POST", body: `[swipe] ${marks.join(" ")}` }); }
  catch { /* 取证通道，失败无所谓 */ }
}
function resetMarks() { t0 = performance.now(); marks.length = 0; mark("start"); }

export function useWorkspaceSwipe({ index, count, onCommit }: {
  index: number;
  count: number;
  onCommit: (nextIndex: number) => void;
}): WorkspaceSwipe {
  const [settling, setSettling] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** 拖动方向（+1 = 下一空间在右侧 / -1 = 在左侧）。收尾全程保留。 */
  const [dir, setDir] = useState(0);
  /** 本次手势中途已经换过空间：布局固定成"换之前的在左、新的在右"。 */
  const [swapped, setSwapped] = useState(false);
  const settlingRef = useRef(false);
  const st = useRef({ armed: 0, acc: 0, coolUntil: 0, settleTimer: 0, endTimer: 0, dir: 0, swapped: false });
  const live = useRef({ startX: 0, startY: 0, locked: false, pointerId: -1 });
  const strip = useRef<HTMLDivElement | null>(null);
  const dragPx = useRef(0);
  const frame = useRef(0);
  const releaseFrame = useRef(0);
  const switchFrame = useRef(0);

  const enterSettling = useCallback((on: boolean) => {
    settlingRef.current = on;
    setSettling(on);
  }, []);

  const clearTimers = useCallback(() => {
    const s = st.current;
    for (const k of ["settleTimer", "endTimer"] as const) { if (s[k]) { clearTimeout(s[k]); s[k] = 0; } }
  }, []);
  useEffect(() => clearTimers, [clearTimers]);
  useEffect(() => () => {
    if (frame.current) cancelAnimationFrame(frame.current);
    if (releaseFrame.current) cancelAnimationFrame(releaseFrame.current);
    if (switchFrame.current) cancelAnimationFrame(switchFrame.current);
  }, []);

  /** 静止位：布局是"旧的在左"时（收尾中 / 往回拖）整条停在 -100%。 */
  const restShift = useCallback((negative: boolean) => (negative ? "-100%" : "0px"), []);

  const paint = useCallback(() => {
    frame.current = 0;
    const el = strip.current;
    if (!el) return;
    const rest = restShift(st.current.dir < 0 || st.current.swapped);
    el.style.transform = rest === "0px"
      ? `translateX(${dragPx.current}px)`
      : `translateX(${rest}) translateX(${dragPx.current}px)`;
  }, [restShift]);

  const schedulePaint = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(paint);
  }, [paint]);

  const stripRef = useCallback((el: HTMLDivElement | null) => {
    strip.current = el;
  }, []);

  const paneWidth = useCallback(() => strip.current?.clientWidth ?? 240, []);

  /** 换空间：延到"这一帧上屏之后"再发，让侧栏先落在最终样子上
   *  （主区那下是重活：整份会话视图卸载 + 新会话挂载）。不可撤销，也不可取消。 */
  const fireSwitch = useCallback((target: number) => {
    if (switchFrame.current) return;
    switchFrame.current = requestAnimationFrame(() => {
      switchFrame.current = 0;
      window.setTimeout(() => { mark("switch"); onCommit(target); }, 0);
    });
  }, [onCommit]);

  /** 收尾：撤掉行内 transform（隔一帧，见文件尾），条子弹回静止位；
   *  过渡走完再撤邻居片。切不切换早就定了（到位即换），这里只管把界面收干净。 */
  const endGesture = useCallback(() => {
    if (settlingRef.current) return;
    mark("end");
    const s = st.current;
    live.current.pointerId = -1;
    s.acc = 0;
    s.armed = 0;
    setDragging(false);
    if (frame.current) { cancelAnimationFrame(frame.current); frame.current = 0; }
    if (releaseFrame.current) cancelAnimationFrame(releaseFrame.current);
    releaseFrame.current = requestAnimationFrame(() => {
      releaseFrame.current = 0;
      if (strip.current) strip.current.style.transform = "";
      dragPx.current = 0;
    });
    enterSettling(true);
    clearTimers();
    s.endTimer = window.setTimeout(() => {
      s.endTimer = 0;
      s.dir = 0;
      s.swapped = false;
      setDir(0);
      setSwapped(false);
      enterSettling(false);
    }, SETTLE_MS_TOTAL);
  }, [clearTimers, enterSettling]);

  /** 跟手途中刷新位移与方向，并在到位时换空间。 */
  const applyDrag = useCallback((dx: number) => {
    // **收尾动画期间输入不接管**（用户 2026-09-30 定："动画要独立完整"）。
    if (settlingRef.current) return;
    const s = st.current;
    if (s.settleTimer) { clearTimeout(s.settleTimer); s.settleTimer = 0; }
    s.acc = dx;
    // 内容左移（dx<0）露出右侧的下一个 → dir=+1。wheel 与 pointer 同一口径。
    if (Math.abs(dx) >= 4 && s.dir !== Math.sign(dx) * -1 && !s.swapped) {
      s.dir = Math.sign(dx) * -1;
      setDir(s.dir);
      mark("dir");
    }
    if (Math.abs(dx) >= ARM_PX) s.armed = Math.sign(dx) * -1;
    dragPx.current = damp(dx, paneWidth());
    setDragging(true);
    schedulePaint();
    if (marks.length < 2) mark("drag");

    // **到位即换**（不等松手/惯性尾巴）。换过之后继续跟手：内容已经基本到位，
    // 视觉上不断点；换空间不可撤销，所以也不再看反向意图。
    if (!s.swapped && Math.abs(dragPx.current) >= paneWidth() * COMMIT_AT) {
      const target = index + s.dir;
      if (s.dir !== 0 && target >= 0 && target < count && performance.now() >= s.coolUntil) {
        s.swapped = true;
        s.coolUntil = performance.now() + COOLDOWN_MS;
        setSwapped(true);
        mark(`swap->${target}`);
        schedulePaint();          // 布局要换成"旧的在左"，静止位随之变成 -100%
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
    neighborBefore: swapped || dir < 0,
    dragging, wheel, pointerDown, pointerMove, pointerUp,
  };
}
