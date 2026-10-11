// 会话流滚动容器的接线：贴底 padding 自愈、顶部模糊带强度、回到底部缓动。
// 只管"容器怎么滚"；要不要跟着底部走（follow）归 useFollowTail，滚到顶翻页与
// 阅读进度上报仍由调用方的 onScroll 承担。refs 由调用方持有并传入——scrollRef
// 供 useSessionEvents/FindInConversation 共用，flowRef 供页内查找取词根。
import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject, RefObject } from "react";
import { placeReadingProgress, readingProgressOf } from "./readingProgress";

/** 顶部模糊带满强度所需的滚动深度（px）：雾的渐显与内容渐隐共用这一个深度，
 *  两条边同步走完，不会各显各的。 */
const FADE_RAMP_PX = 96;

export function useSessionFlowScroll({ scrollRef, flowRef, followRef }: {
  scrollRef: MutableRefObject<HTMLDivElement | null>;
  flowRef: MutableRefObject<HTMLDivElement | null>;
  followRef: RefObject<boolean>;
}) {
  // 底部悬浮区（用户定稿「消息区下延贴底」）：composer 悬浮于消息流之上，
  // flow 的 padding-bottom 按悬浮区实测高度动态设置（附件/排队坞/多行输入
  // 都会改变它），滚到底时最后一条消息恰好停在悬浮区上方 16px。
  // 接线必须自愈：WS 断连/引擎重启期间 React 可长期不重渲染，ref 不重触发，
  // ResizeObserver 也可能落在死节点上（实测 padding 静默丢失）——RO 之外加
  // 1s 看门狗，节点换新或断观察都会在一秒内重新接上。
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const padObserver = useRef<ResizeObserver | null>(null);
  const observedBottom = useRef<Element | null>(null);
  const scrollAnim = useRef<number | null>(null);
  // padding 无变化时绝不碰滚动位置——贴底强拉只允许发生在「悬浮区确实
  // 长高/变矮且用户处于跟随态」时；无条件的 wasAtBottom 强拉会和用户上滑
  // 对抗（底部鬼畜事故：内联 ref 每渲染重挂 → 本函数被渲染节奏反复调用 →
  // 48px 内上滑被不停拽回底部）。
  const syncBottomPad = useCallback(() => {
    const flow = flowRef.current;
    const bottom = bottomRef.current;
    if (!flow || !bottom) return;
    if (observedBottom.current !== bottom) {
      padObserver.current?.disconnect();
      const ro = new ResizeObserver(syncBottomPad);
      ro.observe(bottom);
      padObserver.current = ro;
      observedBottom.current = bottom;
    }
    const next = `${bottom.offsetHeight + 16}px`;
    if (flow.style.paddingBottom === next) return;
    flow.style.paddingBottom = next;
    if (followRef.current) flow.scrollTop = flow.scrollHeight;
  }, [flowRef, followRef]);
  useEffect(() => {
    const t = setInterval(syncBottomPad, 1000);
    return () => {
      clearInterval(t);
      padObserver.current?.disconnect();
      if (scrollAnim.current !== null) cancelAnimationFrame(scrollAnim.current);
    };
  }, [syncBottomPad]);

  // ref 回调必须稳定（useCallback）：内联箭头每次渲染换新身份，React 每渲染
  // 都 detach/reattach → syncBottomPad 被渲染节奏反复调用（鬼畜事故帮凶）。
  const attachFlow = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    flowRef.current = el;
    syncBottomPad();
    // 会话页整体重挂（SessionView 以 sessionId 为 key）：读数按新容器重算一次，
    // 否则新选中的会话顶着上一个会话的灰底，要等它自己滚一下才纠正。挂载时流还
    // 是空的（读数 0）；历史到达后贴底那一次滚动会自己补上。落位而非收敛：新会话
    // 的灰底不该从上一个会话的读数扫过来。
    if (el) placeReadingProgress(readingProgressOf(el));
  }, [scrollRef, flowRef, syncBottomPad]);

  // 顶部模糊带强度 = 滚动深度，0→1 走 FADE_RAMP_PX（内容淡出段走完，雾正好到
  // 满强度）。写的是**模糊半径的倍率**而非整体 opacity：opacity<1 会让面板自建
  // backdrop root，backdrop-filter 采样空组、模糊整个消失（theme.css 有实测记录）。
  // 直接写 CSS 变量、不进 state——每帧都变的值走 React 会把整条会话流拖进滚动重渲。
  const fadeRef = useRef<HTMLDivElement | null>(null);
  // 两个量走同一深度：模糊强度（乘进半径）与内容渐隐长度（--flow-fade-live）。渐隐长度
  // 必须连续长出来——布尔挂上固定长度会让顶部内容越过阈值那一刻整片瞬间变暗，而模糊尚
  // 未开始，观感就是「过渡僵硬」。
  const syncFadeRamp = useCallback((top: number) => {
    const depth = Math.min(1, top / FADE_RAMP_PX);
    fadeRef.current?.style.setProperty("--session-fade-ramp", String(depth));
    flowRef.current?.style.setProperty("--flow-fade-live", `${Math.min(FADE_RAMP_PX, Math.max(0, top))}px`);
  }, [flowRef]);
  // 带子在预览全屏切换时会重挂（重挂即丢变量）：挂上就按当前深度补一次，
  // 否则退出全屏要等下一次滚动雾才回来。
  const attachFade = useCallback((el: HTMLDivElement | null) => {
    fadeRef.current = el;
    if (el) syncFadeRamp(flowRef.current?.scrollTop ?? 0);
  }, [flowRef, syncFadeRamp]);
  const attachBottom = useCallback((el: HTMLDivElement | null) => {
    bottomRef.current = el;
    syncBottomPad();
  }, [syncBottomPad]);

  // 回到底部：rAF 缓动（ease-out-cubic）。WKWebView 原生 smooth 的时长与
  // 松紧不可控；且 content-visibility 的估高在跳达后被真实高度替换、
  // scrollHeight 会漂移——落点后下一帧再校准一次。
  const scrollFlowToBottom = useCallback((smooth: boolean) => {
    const flow = flowRef.current;
    if (!flow) return;
    if (scrollAnim.current !== null) { cancelAnimationFrame(scrollAnim.current); scrollAnim.current = null; }
    const settle = () => { flow.scrollTop = flow.scrollHeight; };
    const from = flow.scrollTop;
    const distance = flow.scrollHeight - flow.clientHeight - from;
    if (!smooth || distance < 2) { settle(); return; }
    const duration = Math.min(480, 220 + distance * 0.08);
    const t0 = performance.now();
    const step = (now: number) => {
      if (flowRef.current !== flow) return; // 中途切会话：动画作废
      const p = Math.min(1, (now - t0) / duration);
      flow.scrollTop = from + distance * (1 - Math.pow(1 - p, 3));
      if (p < 1) {
        scrollAnim.current = requestAnimationFrame(step);
        return;
      }
      // 落点后持续校准：content-visibility 估高在跳达后被真实高度替换，
      // scrollHeight 会连漂几帧，双帧校准不够（实测停在离底 322px 处）。
      // 连续两帧位置无变化才收手（≤12 帧封顶）；期间用户上滑（follow
      // 翻 false）立即中止，绝不和人抢滚动。
      let stable = 0;
      let frames = 0;
      let lastSt = -1;
      const stabilize = () => {
        if (flowRef.current !== flow || !followRef.current) { scrollAnim.current = null; return; }
        flow.scrollTop = flow.scrollHeight;
        const st = flow.scrollTop;
        stable = Math.abs(st - lastSt) < 1 ? stable + 1 : 0;
        lastSt = st;
        frames += 1;
        if (stable < 2 && frames < 12) scrollAnim.current = requestAnimationFrame(stabilize);
        else scrollAnim.current = null;
      };
      scrollAnim.current = requestAnimationFrame(stabilize);
    };
    scrollAnim.current = requestAnimationFrame(step);
  }, [flowRef, followRef]);

  return { attachFlow, attachFade, attachBottom, syncFadeRamp, scrollFlowToBottom };
}
