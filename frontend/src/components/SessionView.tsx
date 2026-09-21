import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { t, useT } from "../i18n";
import { Composer } from "./Composer";
import { HeroBrand } from "./HeroBrand";
import { LoadingState } from "./LoadingState";
import { planReviewOf } from "../planReview";
import { PlanReviewCard } from "./PlanReviewCard";
import { StatusCapsule, SubagentReadOnlyNotice } from "./StatusCapsule";
import { groupTurns, type TurnGroup } from "../turnGroups";
import { Item } from "../session/Item";
import { useSessionActions } from "../session/useSessionActions";
import { TurnNavigator } from "../session/TurnNavigator";
import { FilePreviewOverlay, FilePreviewSurface, PreviewPageHeader } from "./preview/FilePreviewWindow";
import { useFilePreview } from "./preview/useFilePreview";
import { computeTurnProcess } from "../session/turnProcess";
import { FOLLOW_THRESHOLD, activeTurnFor, readingLineOffset } from "../session/activeTurn";
import { TurnProcessBar } from "../session/TurnProcessBar";
import type { TurnOutlineEntry } from "../types";
import { SessionHeader } from "../session/SessionHeader";
import { sessionTitle } from "../session/sessionTitle";
import { ApprovalCard, QuestionCard } from "../session/Cards";
import { QueueDock } from "../session/QueueDock";
import { useSessionEvents } from "../session/useSessionEvents";
import { useSessionModels } from "../session/useSessionModels";

/** 顶部模糊带满强度所需的滚动深度（px）：雾的渐显与内容渐隐共用这一个深度，
 *  两条边同步走完，不会各显各的。 */
const FADE_RAMP_PX = 96;


export function SessionView({ sessionId }: { sessionId: string }) {
  const { lang } = useT(); // 订阅语言切换：文案与标题回退随 lang 重渲染
  const store = useStore();
  const { approvals, questions, queues, sessions } = store;
  const modelFace = useSessionModels(sessionId);
  // 轮内过程折叠（官方 turn-process）：默认收起；Set 记用户手动展开的轮号。
  // 切会话时 SessionView 以 sessionId 重挂，Set 随之清空。
  const [processOpen, setProcessOpen] = useState<ReadonlySet<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [follow, setFollow] = useState(true);
  // 渐隐边缘信号（超限标准 UI，样式走 .flow 上的 .fade-y）：不用
  // useEdgeFade——底部要跟 follow（jump-down 同源、32px 容差、ref 镜像
  // 供 syncBottomPad 同步读）保持一个事实源，拆两套监听会算出两个贴底。
  const [scrolled, setScrolled] = useState(false);
  const olderAnchorRef = useRef<HTMLElement | null>(null);
  const { items, liveRunning, runningSince, plan, scheduleRecords, hasMore, loadingOlder, loadOlder, outline, loadThrough, loadError, retry } =
    useSessionEvents(sessionId, { scrollRef, olderAnchorRef });
  const summary = sessions.find((s) => s.sessionId === sessionId);
  const title = summary ? sessionTitle(summary, lang) : t("会话");
  // Turn 大纲轨（TODO §0-2）：活动轮（滚动派生）与深分页忙碌轮。
  const [activeTurn, setActiveTurn] = useState<number | undefined>(undefined);
  const [busyTurn, setBusyTurn] = useState<number | undefined>(undefined);
  // 文件预览窗口（产物/文件 chip 打开）：little 浮窗与全屏两态
  const preview = useFilePreview();
  const previewFull = preview.tabs.length > 0 && preview.fullscreen;
  // 产物/预览路径解析：模型常写 cwd 相对路径，/api/file 与壳动作都要绝对路径
  const wsPath = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId)?.path;
  // 会话动作回调（打开预览 / 分叉 / 继续）：三者都要引用稳定，契约与出处见该 hook。
  const { openPreviewFile, branchFrom, continueTurn } = useSessionActions({ sessionId, store, preview, wsPath });

  // 底部悬浮区（用户定稿「消息区下延贴底」）：composer 悬浮于消息流之上，
  // flow 的 padding-bottom 按悬浮区实测高度动态设置（附件/排队坞/多行输入
  // 都会改变它），滚到底时最后一条消息恰好停在悬浮区上方 16px。
  // 接线必须自愈：WS 断连/引擎重启期间 React 可长期不重渲染，ref 不重触发，
  // ResizeObserver 也可能落在死节点上（实测 padding 静默丢失）——RO 之外加
  // 1s 看门狗，节点换新或断观察都会在一秒内重新接上。
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<HTMLDivElement | null>(null);
  const padObserver = useRef<ResizeObserver | null>(null);
  const observedBottom = useRef<Element | null>(null);
  const scrollAnim = useRef<number | null>(null);
  // follow 的渲染期镜像：syncBottomPad 需要同步读「用户是否处于贴底跟随」，
  // onScroll 里的 setFollow 是异步的，直接读 state 拿到的是旧值。
  const followRef = useRef(true);
  followRef.current = follow;
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
  }, []);
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
  }, [syncBottomPad]);
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
  }, []);
  // 带子在预览全屏切换时会重挂（重挂即丢变量）：挂上就按当前深度补一次，
  // 否则退出全屏要等下一次滚动雾才回来。
  const attachFade = useCallback((el: HTMLDivElement | null) => {
    fadeRef.current = el;
    if (el) syncFadeRamp(flowRef.current?.scrollTop ?? 0);
  }, [syncFadeRamp]);
  const attachBottom = useCallback((el: HTMLDivElement | null) => {
    bottomRef.current = el;
    syncBottomPad();
  }, [syncBottomPad]);

  // 回到底部：rAF 缓动（ease-out-cubic）。WKWebView 原生 smooth 的时长与
  // 松紧不可控；且 content-visibility 的估高在跳达后被真实高度替换、
  // scrollHeight 会漂移——落点后下一帧再校准一次。
  const scrollFlowToBottom = (smooth: boolean) => {
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
  };




  useEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items, follow]);


  const pending = [...approvals.values()].filter((a) => a.sessionId === sessionId);
  const sessionQuestions = [...questions.values()].filter((q) => q.sessionId === sessionId);
  // 排队消息（placement=queued 才可操作；steering/context 正在处理）
  // 排队 + 插话中（0.1.5：steering 也呈现）；本端刚发出未观察到的走「发送中」。
  const sessionQueue = queues.get(sessionId) ?? [];
  const queuedItems = sessionQueue.filter((i) => i.placement === "queued" || i.placement === "steering");
  const [sendingRpcIds, setSendingRpcIds] = useState<ReadonlySet<string>>(new Set());
  const registerSending = (rpcId: string) => {
    setSendingRpcIds((prev) => new Set(prev).add(rpcId));
    // 快照观察到该消息（rpcId 出现）或 10s 兜底后自动退场
    const stop = () => setSendingRpcIds((prev) => { const n = new Set(prev); n.delete(rpcId); return n; });
    const iv = setInterval(() => {
      if (!(queues.get(sessionId) ?? []).some((i) => i.rpcId === rpcId)) { clearInterval(iv); stop(); }
    }, 500);
    setTimeout(() => { clearInterval(iv); stop(); }, 10000);
  };

  const isBlank = summary ? !!summary.blank : items.length === 0;
  const running = liveRunning || !!summary?.running;
  // 直播项（流式 chunk/思考）只可能是列表最后一项。思考块用它判定「这一条思考
  // 是否还在进行」（官方 `running={streaming && i === last}` 口径）——只看会话级
  // running 的话，同轮后面的工具/答案都已出现、会话还在跑时，早已结束的思考会
  // 一直摊着「思考中」不收起（用户报障）。
  const liveItem = items.length > 0 ? items[items.length - 1] : undefined;
  // 子会话身份投影（0.1.5）：continuable 可继续对话，one-shot 只读。
  const subagentMode = (summary?.projections?.values as { subagent?: { mode?: string } } | undefined)?.subagent?.mode;
  // 用量/占用投影（3.1）：空值时 Composer 内的容量圈不渲染
  const projVals = (summary?.projections?.values ?? {}) as {
    tokenUsage?: { uncachedInputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
    contextPressure?: { projectedTokens?: number; contextWindow?: number };
    contextBreakdown?: { systemTokens?: number; toolsTokens?: number; messageTokens?: number };
    sessionStats?: { turns?: number; steps?: number; llmMs?: number; toolMs?: number; ttftMs?: number; ttftSteps?: number; decodeMs?: number; decodeTokens?: number };
  };
  // 容量圈数据挂在输入框上（发送/听写钮左侧，hover 出面板）
  const ctxData = {
    projected: projVals.contextPressure?.projectedTokens,
    window: projVals.contextPressure?.contextWindow,
    usage: projVals.tokenUsage,
    stats: projVals.sessionStats,
    breakdown: projVals.contextBreakdown,
  };

  // key 索引/末位行扫描/轮分组只在 items 变化时算一次（AUD-092）：流式期间
  // 每条 delta 与其他会话的 store 更新都会触发重渲染，渲染体内重建 Map +
  // 全量扫是纯浪费。渲染全量进行（离屏排版由 .msg-block 的
  // content-visibility 跳过，长会话内存窗口本身有分页上限）。
  const layout = useMemo(() => {
    const keyIdx = new Map(items.map((it, i) => [it.key, i] as const));
    const groups = groupTurns(items);
    // 大纲轨的 loaded 判定集：轮号在内存窗口中即 loaded。
    const loadedTurns = new Set(groups.map((g) => g.turn).filter((n): n is number => n !== null));
    return { keyIdx, groups, loadedTurns };
  }, [items]);

  // 视口所在轮（rAF 合并）：贴底取最后一轮、否则取阅读线上方最新一轮，
  // 驱动大纲轨高亮（判定在 activeTurn.ts，语义照官方 ChatView）。
  const activeRafRef = useRef<number | null>(null);
  const railTurns = useMemo(() => outline.map((e) => e.turn), [outline]);
  const trackActive = useCallback(() => {
    if (activeRafRef.current !== null) return;
    activeRafRef.current = requestAnimationFrame(() => {
      activeRafRef.current = null;
      const flow = flowRef.current;
      if (!flow) return;
      const atBottom = flow.scrollHeight - flow.scrollTop - flow.clientHeight <= FOLLOW_THRESHOLD + 1;
      let reading: number | null = null;
      if (!atBottom) {
        const line = flow.getBoundingClientRect().top + readingLineOffset(flow.clientHeight);
        for (const el of flow.querySelectorAll<HTMLElement>(".turn-group[data-turn]")) {
          if (el.getBoundingClientRect().top <= line) reading = Number(el.dataset.turn);
          else break;
        }
      }
      setActiveTurn(activeTurnFor(atBottom, reading, railTurns) ?? undefined);
    });
  }, [railTurns]);
  useEffect(() => {
    trackActive();
    return () => {
      if (activeRafRef.current !== null) cancelAnimationFrame(activeRafRef.current);
      activeRafRef.current = null;
    };
  }, [items, trackActive]);

  // 大纲跳转落点：等目标轮组进 DOM 后对齐到流顶（翻页渲染是异步的，帧重试）。
  const scrollToTurn = (turn: number) => {
    let frames = 0;
    const step = () => {
      const flow = flowRef.current;
      if (!flow) return;
      const group = flow.querySelector<HTMLElement>(`.turn-group[data-turn="${turn}"]`);
      if (group) {
        flow.scrollTop += group.getBoundingClientRect().top - flow.getBoundingClientRect().top - 8;
        return;
      }
      if (frames++ < 12) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const pickTurn = async (e: TurnOutlineEntry) => {
    // 未在内存窗口：先深分页覆盖到该轮 turn/start 的 seq（官方 loadThrough）。
    if (!layout.loadedTurns.has(e.turn)) {
      setBusyTurn(e.turn);
      try {
        await loadThrough(e.seq);
      } finally {
        setBusyTurn(undefined);
      }
    }
    scrollToTurn(e.turn);
  };

  if (isBlank) {
    return (
      <>
        <div className="session-header">
          <SessionHeader title={title} face={modelFace} />
        </div>
        <div className="hero">
          <HeroBrand />
          <div className="hero-composer">
            <Composer sessionId={sessionId} ctx={ctxData} registerSending={registerSending} />
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="session">
      {/* 顶部渐隐层：滚上去的内容在头部下面被渐变吃掉 + 模糊（样式见 theme.css）。
          六个 <i> 是渐进模糊的六层（半径从峰值逐层减半、各占带高 1/6 的波段），
          层数写在 theme.css 的 nth-child 规则里，与这里是一对——改层数两处一起改。
          全屏预览时一并隐藏——那是另一个页面。 */}
      {!previewFull && (
        <div className="session-fade" ref={attachFade} aria-hidden="true">
          <i /><i /><i /><i /><i /><i />
        </div>
      )}
      {/* 全屏预览 = 打开成的新页面：页头换成「返回 + 文件名 + 打开方式」，
          会话自己的标题/模型/胶囊整体让位（不再是"会话界面顶着文件"）。 */}
      {previewFull ? <PreviewPageHeader preview={preview} /> : (
      <div className="session-header">
        {/* key=会话：切会话时标题行整体重挂播 header-in 入场（标题更新/流式
            改名不换 key，不重播）。 */}
        <SessionHeader key={sessionId} title={title} face={modelFace} />
        {plan?.active && !plan?.pending && (
          <span className="plan-wrap">
            <button
              type="button"
              className="plan-chip"
              data-tip={t("退出计划模式")}
              aria-label={t("退出计划模式")}
              onClick={() => {
                api.commandExecute({ agentId: sessionId, line: "/plan off" })
                  .catch(() => void 0); // 引擎忙时退出指令丢失：芯片由投影轮询纠偏
              }}
            >
              Plan ×
            </button>
          </span>
        )}
        {/* 子会话视图不挂状态胶囊：过程查看经只读说明条返回父会话 */}
        {summary?.origin !== "subagent" && (
          <StatusCapsule sessionId={sessionId} scheduleRecords={scheduleRecords} />
        )}
      </div>
      )}
      {/* 会话体：消息流 + 悬浮输入区 + （全屏预览时）盖在其上的预览面。
          全屏不让底下两颗卸载——滚动位置与事件状态都在它们身上，停绘制即可。 */}
      <div className="session-body" data-fullscreen={previewFull || undefined}>
        <div className="flow-row">
          {outline.length >= 2 && (
            <TurnNavigator
              entries={outline}
              activeTurn={activeTurn}
              busyTurn={busyTurn}
              loadedTurns={layout.loadedTurns}
              onPick={(e) => void pickTurn(e)}
            />
          )}
        <div
          className="flow fade-y"
          ref={attachFlow}
          data-fade-start={scrolled ? "" : undefined}
          data-fade-end={!follow ? "" : undefined}
          onScroll={(e) => {
            const el = e.currentTarget;
            setFollow(el.scrollTop + el.clientHeight >= el.scrollHeight - 32);
            setScrolled(el.scrollTop > 2);
            syncFadeRamp(el.scrollTop);
            trackActive();
            // 滚到顶自动向前翻页（替代手点「载入更早」）：靠近顶部即拉一页；
            // loadOlder 内部有 paging 互斥 + 锚点保位，连续触发安全。
            if (el.scrollTop < 48 && hasMore && !loadingOlder) void loadOlder();
          }}
        >
          {/* key=会话:已加载——历史到达那一刻（off→on）重挂播 session-enter
              入场；流式增量不换 key 不重播；未加载完保持 off 不播（空容器） */}
          <div className="flow-inner" key={`${sessionId}:${items.length > 0 ? "on" : "off"}`}>
            {loadError && items.length === 0 && (
              <div className="load-error" role="alert">
                {t("历史加载失败")}
                <button type="button" onClick={retry}>{t("重试")}</button>
              </div>
            )}
            {loadingOlder && (
              <div className="load-older" aria-live="polite">{t("加载中…")}</div>
            )}
            {(() => {
              // DSH data-actions-reveal 的移植变体（用户定稿偏离官方）：官方是
              // 图标常驻、时间标签 hover；这里统一为按钮+Meta 全部 hover 才显现，
              // 作用域挂在轮容器 .turn-group 上——悬停轮内正文/工具/气泡即显现
              // 本轮的 user chrome 与 turn-tail meta。
              const { keyIdx, groups } = layout;
              const nodes: React.ReactNode[] = [];
              groups.forEach((g: TurnGroup, gi: number) => {
                // 直播轮（会话在跑 且 是最后一轮）挂 .live 作用域：工具行等
                // 流内元素挂载时播对焦动画；历史轮与已收尾的轮不播。
                const isLiveGroup = running && gi === groups.length - 1;
                // 轮内过程折叠：已闭合轮把最终回答之前的工具/中间消息收成披露条；
                // 默认收起，点击展开。正在跑的轮（无 turn-tail）不折。
                const proc = g.turn !== null ? computeTurnProcess(g.items) : null;
                const procOpen = proc !== null && g.turn !== null && processOpen.has(g.turn);
                const toggleProc = g.turn !== null
                  ? (open: boolean) => {
                      const turnNo = g.turn as number;
                      setProcessOpen((prev) => {
                        const next = new Set(prev);
                        if (open) next.add(turnNo);
                        else next.delete(turnNo);
                        return next;
                      });
                    }
                  : null;
                const barAt = proc ? (proc.processIndices[0] ?? proc.answerIndex) : -1;
                let procBarEmitted = false;
                nodes.push(
                  <div key={`turn-${g.turn ?? "head"}-${gi}`} className={`turn-group${isLiveGroup ? " live" : ""}`} data-actions-reveal="hover" data-turn={g.turn ?? undefined}>
                    {g.items.map((item, ii) => {
                      const isProcessMember = proc !== null
                        && ii < proc.answerIndex
                        && proc.processIndices.includes(ii);
                      const hideItem = isProcessMember && !procOpen;
                      // 披露条挂在过程窗起点（首个过程项；无外部过程时挂最终回答前），
                      // 该起点项被收起时仍要吐出条子，否则折叠态无处点开。
                      const barHere = proc !== null && toggleProc !== null
                        && !procBarEmitted && ii === barAt;
                      if (barHere) procBarEmitted = true;
                      const bar = barHere && proc && toggleProc ? (
                        <TurnProcessBar
                          info={proc}
                          open={procOpen}
                          onToggle={() => toggleProc(!procOpen)}
                        />
                      ) : null;
                      if (hideItem) return bar ? <span key={item.key} className="turn-process-slot">{bar}</span> : null;
                      const idx = keyIdx.get(item.key) ?? -1;
                      const isAnswer = proc !== null && ii === proc.answerIndex;
                      return (
                        <div
                          key={item.key}
                          className="chat-anchor-row"
                          ref={idx === 0 ? ((el: HTMLDivElement | null) => { olderAnchorRef.current = el; }) : undefined}
                        >
                          {bar}
                          <Item
                            item={item}
                            running={running && item === liveItem}
                            onBranch={branchFrom}
                            sessionId={sessionId}
                            onPreviewFile={openPreviewFile}
                            wsPath={wsPath}
                            cwd={summary?.cwd}
                            hideThinking={isAnswer && !procOpen && !!proc?.inlineReasoning}
                            onContinue={continueTurn}
                          />
                        </div>
                      );
                    })}
                  </div>,
                );
              });
              return nodes;
            })()}
            {pending.map((a) => (
              <ApprovalCard key={a.eventId} eventId={a.eventId} toolName={a.toolName} reason={a.reason} />
            ))}
            {sessionQuestions.map((q) => {
              // plan-review 提意 → 决策卡接管；其余保持通用提问流（官方分流规则）
              const review = planReviewOf(q.questions);
              if (review) {
                return <PlanReviewCard key={q.eventId} eventId={q.eventId} review={review} />;
              }
              return <QuestionCard key={q.eventId} eventId={q.eventId} questions={q.questions} />;
            })}
            {running && <LoadingState label="Deep diving..." since={runningSince} />}
          </div>
        </div>
        </div>
        {!follow && (
          <button
            className="jump-down"
            data-tip={t("回到最新")}
            onClick={() => scrollFlowToBottom(true)}
          >
            <ArrowDown size={16} />
          </button>
        )}
        <div
          className="session-bottom"
          ref={attachBottom}
        >
          {queuedItems.length > 0 && (
            <div className="queue-dock-wrap">
              <QueueDock sessionId={sessionId} items={queuedItems} sendingRpcIds={sendingRpcIds} />
            </div>
          )}
          {summary?.origin === "subagent" && (subagentMode !== "continuable" || !summary.parentSessionId) ? (
            <SubagentReadOnlyNotice parentSessionId={summary.parentSessionId} />
          ) : summary?.origin === "subagent" ? (
            // continuable 子会话（0.1.5）：subagents/prompt 经父会话投递
            <Composer sessionId={sessionId} ctx={ctxData} variant={{ kind: "subagent", parentSessionId: summary.parentSessionId! }} registerSending={registerSending} />
          ) : (
            <Composer sessionId={sessionId} ctx={ctxData} registerSending={registerSending} />
          )}
        </div>
      {previewFull && <FilePreviewSurface preview={preview} />}
      </div>
      {preview.tabs.length > 0 && !previewFull && <FilePreviewOverlay preview={preview} />}
    </div>
  );
}

