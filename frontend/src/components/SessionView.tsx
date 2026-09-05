import { useEffect, useMemo, useRef, useState } from "react";
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
  const olderAnchorRef = useRef<HTMLElement | null>(null);
  const { items, liveRunning, runningSince, plan, goalProj, refreshGoal, scheduleRecords, hasMore, loadingOlder, loadOlder, loadError, retry } =
    useSessionEvents(sessionId, { scrollRef, olderAnchorRef });
  const summary = sessions.find((s) => s.sessionId === sessionId);
  const title = summary ? sessionTitle(summary, lang) : t("会话");

  // 底部悬浮区（用户定稿「消息区下延贴底」）：composer 悬浮于消息流之上，
  // flow 的 padding-bottom 按悬浮区实测高度动态设置（附件/排队坞/多行输入
  // 都会改变它），滚到底时最后一条消息恰好停在悬浮区上方 16px；贴底状态
  // 下悬浮区长高自动重新贴底。
  // 用回调 ref 而非 effect+deps：flow/悬浮区节点会被 React 换新（切会话/
  // 空态切换），effect 依赖不变就不重跑，观察器会落在死节点上——回调 ref
  // 在节点每次挂载时触发，保证观察器永远接在活节点上。
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<HTMLDivElement | null>(null);
  const padObserver = useRef<ResizeObserver | null>(null);
  const syncBottomPad = () => {
    const flow = flowRef.current;
    const bottom = bottomRef.current;
    if (!flow || !bottom) return;
    const wasAtBottom = flow.scrollTop + flow.clientHeight >= flow.scrollHeight - 48;
    flow.style.paddingBottom = `${bottom.offsetHeight + 16}px`;
    if (wasAtBottom) flow.scrollTop = flow.scrollHeight;
  };
  const attachPadSync = () => {
    padObserver.current?.disconnect();
    padObserver.current = null;
    const flow = flowRef.current;
    const bottom = bottomRef.current;
    if (!flow || !bottom) return;
    syncBottomPad();
    const ro = new ResizeObserver(syncBottomPad);
    ro.observe(bottom);
    padObserver.current = ro;
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
        <SessionHeader title={title} face={modelFace} />
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
        ref={(el) => { scrollRef.current = el; flowRef.current = el; attachPadSync(); }}
        onScroll={(e) => {
          const el = e.currentTarget;
          setFollow(el.scrollTop + el.clientHeight >= el.scrollHeight - 32);
        }}
      >
        <div className="flow-inner">
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
          onClick={() => {
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
            setFollow(true);
          }}
        >
          <ArrowDown size={16} />
        </button>
      )}
      <div
        className="session-bottom"
        ref={(el) => { bottomRef.current = el; attachPadSync(); }}
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

