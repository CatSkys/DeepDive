import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { t, tt, useT } from "../i18n";
import { Composer } from "./Composer";
import { HeroBrand } from "./HeroBrand";
import { LoadingState } from "./LoadingState";
import { planReviewOf } from "../planReview";
import { PlanReviewCard } from "./PlanReviewCard";
import { GoalBar } from "./GoalBar";
import { StatusCapsule, SubagentReadOnlyNotice } from "./StatusCapsule";
import { groupTurns, foldDecision, type TurnGroup } from "../turnGroups";
import { Item } from "../session/Item";
import { SessionHeader } from "../session/SessionHeader";
import { sessionTitle } from "../session/sessionTitle";
import { ApprovalCard, QuestionCard } from "../session/Cards";
import { QueueDock } from "../session/QueueDock";
import { useSessionEvents } from "../session/useSessionEvents";
import { useSessionModels } from "../session/useSessionModels";


export function SessionView({ sessionId }: { sessionId: string }) {
  const { lang } = useT(); // 订阅语言切换：文案与标题回退随 lang 重渲染
  const store = useStore();
  const { approvals, questions, queues, sessions } = store;
  const modelFace = useSessionModels(sessionId);
  // 轮折叠开关（长会话默认折叠早前轮；点击折叠条或关闭开关展开）
  const [turnsFolded, setTurnsFolded] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [follow, setFollow] = useState(true);
  // 已下滚（离开顶端）：顶部渐隐边缘的开关；与 follow 一起在 onScroll 里维护
  const [scrolled, setScrolled] = useState(false);
  const olderAnchorRef = useRef<HTMLElement | null>(null);
  const { items, liveRunning, runningSince, plan, goalProj, refreshGoal, scheduleRecords, hasMore, loadingOlder, loadOlder, loadError, retry } =
    useSessionEvents(sessionId, { scrollRef, olderAnchorRef });
  const summary = sessions.find((s) => s.sessionId === sessionId);
  const title = summary ? sessionTitle(summary, lang) : t("会话");

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
  const queuedItems = (queues.get(sessionId) ?? []).filter((i) => i.placement === "queued");

  // branch（官方 forkAt）：从轮收尾 seq 分叉子会话并切入；失败保持原会话不动。
  const branchFrom = (atSeq: number) => {
    api.fork({ sessionId, atSeq })
      .then((r) => {
        void store.refresh();
        store.openSession(r.sessionId);
      })
      .catch(() => void 0); // fork 失败留在当前会话：无部分状态可回滚
  };

  const isBlank = summary ? !!summary.blank : items.length === 0;
  const running = liveRunning || !!summary?.running;
  // 用量/占用投影（3.1）：空值时 Composer 内的容量圈不渲染
  const projVals = (summary?.projections?.values ?? {}) as {
    tokenUsage?: { uncachedInputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
    contextPressure?: { projectedTokens?: number; contextWindow?: number };
    contextBreakdown?: { systemTokens?: number; toolsTokens?: number; messageTokens?: number };
  };
  // 容量圈数据挂在输入框上（发送/听写钮左侧，hover 出面板）
  const ctxData = {
    projected: projVals.contextPressure?.projectedTokens,
    window: projVals.contextPressure?.contextWindow,
    usage: projVals.tokenUsage,
    breakdown: projVals.contextBreakdown,
  };

  // key 索引/末位行扫描/轮分组只在 items 变化时算一次（AUD-092）：流式期间
  // 每条 delta 与其他会话的 store 更新都会触发重渲染，渲染体内重建 Map +
  // 全量扫是纯浪费；折叠开关只影响 foldFrom，不参与本 memo。
  const layout = useMemo(() => {
    const keyIdx = new Map(items.map((it, i) => [it.key, i] as const));
    const groups = groupTurns(items);
    const fold = foldDecision(groups.length);
    return { keyIdx, groups, fold };
  }, [items]);

  if (isBlank) {
    return (
      <>
        <div className="session-header">
          <SessionHeader title={title} face={modelFace} />
        </div>
        <div className="hero">
          <HeroBrand />
          <div className="hero-composer">
            <GoalBar projection={goalProj} onChange={refreshGoal} sessionId={sessionId} />
            <Composer sessionId={sessionId} ctx={ctxData} />
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="session">
      <div className="session-header">
        {/* key=会话：切会话时标题行整体重挂播 header-in 入场（标题更新/流式
            改名不换 key，不重播） */}
        <SessionHeader key={sessionId} title={title} face={modelFace} />
        {plan?.active && !plan?.pending && (
          <span className="plan-wrap">
            <button
              type="button"
              className="plan-chip"
              data-tip={t("退出计划模式")}
              aria-label={t("退出计划模式")}
              onClick={() => {
                api.prompt({
                  sessionId,
                  mode: "queue",
                  content: [{ type: "text", text: "/plan off" }],
                }).catch(() => void 0); // 引擎忙时退出指令丢失：芯片由投影轮询纠偏
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
      <div
        className="flow"
        ref={attachFlow}
        data-fade-top={scrolled ? "" : undefined}
        data-fade-bottom={!follow ? "" : undefined}
        onScroll={(e) => {
          const el = e.currentTarget;
          setFollow(el.scrollTop + el.clientHeight >= el.scrollHeight - 32);
          setScrolled(el.scrollTop > 2);
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
          {hasMore && (
            <button
              type="button"
              className="load-older"
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
            >
              {loadingOlder ? t("加载中…") : t("载入更早")}
            </button>
          )}
          {(() => {
            // DSH data-actions-reveal 的移植变体（用户定稿偏离官方）：官方是
            // 图标常驻、时间标签 hover；这里统一为按钮+Meta 全部 hover 才显现，
            // 作用域挂在轮容器 .turn-group 上——悬停轮内正文/工具/气泡即显现
            // 本轮的 user chrome 与 turn-tail meta。
            // 轮折叠：长会话默认折叠早前轮（除最近 2 轮），折叠条点击展开。
            const { keyIdx, groups, fold } = layout;
            // turnsFolded=false 时 foldFrom=0（全部渲染）；=groups.length 会把整流折空
            const foldFrom = fold && turnsFolded ? fold.foldFrom : 0;
            const nodes: React.ReactNode[] = [];
            let foldedCount = 0;
            let foldBarEmitted = false;
            groups.forEach((g: TurnGroup, gi: number) => {
              if (gi < foldFrom) {
                foldedCount += g.items.length;
                return;
              }
              if (foldedCount > 0) {
                nodes.push(
                  <button
                    key="turn-fold-bar"
                    type="button"
                    className="turn-fold"
                    ref={(el: HTMLButtonElement | null) => { olderAnchorRef.current = el; }}
                    onClick={() => setTurnsFolded(false)}
                  >
                    {tt("已折叠早前 {n} 轮 · 点击展开", "Folded {n} earlier turns · click to expand", { n: foldedCount })}
                  </button>,
                );
                foldedCount = 0;
                foldBarEmitted = true;
              }
              nodes.push(
                <div key={`turn-${g.turn ?? "head"}-${gi}`} className="turn-group" data-actions-reveal="hover">
                  {g.items.map((item) => {
                    const idx = keyIdx.get(item.key) ?? -1;
                    return (
                      <div
                        key={item.key}
                        className="chat-anchor-row"
                        ref={idx === 0 && !foldBarEmitted ? ((el: HTMLDivElement | null) => { olderAnchorRef.current = el; }) : undefined}
                      >
                        <Item
                          item={item}
                          turnRunning={running}
                          onBranch={branchFrom}
                          sessionId={sessionId}
                          onContinue={() => {
                            void api.prompt({ sessionId, mode: "queue", content: [{ type: "text", text: t("继续") }] }).catch(() => void 0); // 发送失败：max-tokens 卡保留，用户可再点
                          }}
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
            <ApprovalCard key={a.approvalId} approvalId={a.approvalId} rpcId={a.rpcId} sessionId={sessionId} toolName={a.toolName} reason={a.reason} />
          ))}
          {sessionQuestions.map((q) => {
            // plan-review 提意 → 决策卡接管；其余保持通用提问流（官方分流规则）
            const review = planReviewOf(q.questions);
            if (review) {
              return <PlanReviewCard key={q.rpcId} rpcId={q.rpcId} sessionId={sessionId} review={review} />;
            }
            return <QuestionCard key={q.rpcId} rpcId={q.rpcId} sessionId={sessionId} questions={q.questions} />;
          })}
          {running && <LoadingState label="Deep diving..." since={runningSince} />}
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
            <QueueDock sessionId={sessionId} items={queuedItems} />
          </div>
        )}
        <GoalBar projection={goalProj} onChange={refreshGoal} sessionId={sessionId} />
        {summary?.origin === "subagent" ? (
          <SubagentReadOnlyNotice parentSessionId={summary.parentSessionId} />
        ) : (
          <Composer sessionId={sessionId} ctx={ctxData} />
        )}
      </div>
    </div>
  );
}

