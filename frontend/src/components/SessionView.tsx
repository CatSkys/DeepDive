import { useEffect, useRef, useState } from "react";
import { ArrowDown, ChevronDown } from "lucide-react";
import { ModelMenu } from "./ModelMenu";
import { WorkspacePill } from "./Sidebar";
import { api } from "../api";
import { useStore } from "../store";
import { t, tt, useT } from "../i18n";
import { Composer } from "./Composer";
import { HeroBrand } from "./HeroBrand";
import LoadingState from "./LoadingState";
import { planReviewOf } from "../planReview";
import { PlanReviewCard } from "./PlanReviewCard";
import { GoalBar } from "./GoalBar";
import { StatusCapsule, SubagentReadOnlyNotice } from "./StatusCapsule";
import { groupTurns, foldDecision, type TurnGroup } from "../turnGroups";
import { Item } from "../session/Item";
import { ApprovalCard, QuestionCard } from "../session/Cards";
import { QueueDock } from "../session/QueueDock";
import { useSessionEvents } from "../session/useSessionEvents";
import { useSessionModels } from "../session/useSessionModels";


export function SessionView({ sessionId }: { sessionId: string }) {
  useT(); // 订阅语言切换：本组件文案走全局 t()/tt()，语言变更时需重渲染
  const store = useStore();
  const { approvals, questions, queues, sessions } = store;
  const { showModels, setShowModels, modelName, models, currentModel, effortLevels, effort, effortLabel, pickModel, applyModelEffort } =
    useSessionModels(sessionId);
  // 轮折叠开关（长会话默认折叠早前轮；点击折叠条或关闭开关展开）
  const [turnsFolded, setTurnsFolded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const olderAnchorRef = useRef<HTMLElement | null>(null);
  const { items, liveRunning, runningSince, plan, goalProj, refreshGoal, scheduleRecords, hasMore, loadingOlder, loadOlder } =
    useSessionEvents(sessionId, { scrollRef, olderAnchorRef });
  const summary = sessions.find((s) => s.sessionId === sessionId);
  const title = summary
    ? (summary.projections?.values?.title as string) || (summary.blank ? t("新会话") : t("会话"))
    : t("会话");




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
      .catch(() => void 0);
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

  if (isBlank) {
    return (
      <>
        <div className="session-header">
          <div className="left">
            <div className="title-row">
              <div className="title">{title}</div>
              <WorkspacePill />
            </div>
            <button className="model trigger" data-open={showModels ? "true" : "false"} onClick={() => setShowModels(true)}>
              {modelName || "Auto"}
              {effortLevels.length > 0 && <span className="effort-tag">{effortLabel(effort)}</span>}
              <ChevronDown size={12} className="trigger-chev" />
            </button>
            {showModels && (
              <ModelMenu
                options={models}
                current={modelName}
                currentModel={currentModel}
                effortValue={effort}
                onPick={(m) => void pickModel(m)}
                onApplyEffort={(m, id) => void applyModelEffort(m, id)}
                onClose={() => setShowModels(false)}
              />
            )}
          </div>
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
        <div className="left">
          <div className="title-row">
            <div className="title">{title}</div>
            <WorkspacePill />
          </div>
          <button className="model trigger" data-open={showModels ? "true" : "false"} onClick={() => setShowModels(true)}>
            {modelName || "Auto"}
            {effortLevels.length > 0 && <span className="effort-tag">{effortLabel(effort)}</span>}
            <ChevronDown size={12} className="trigger-chev" />
          </button>
          {showModels && (
            <ModelMenu
              options={models}
              current={modelName}
              currentModel={currentModel}
              effortValue={effort}
              onPick={(m) => void pickModel(m)}
              onApplyEffort={(m, id) => void applyModelEffort(m, id)}
              onClose={() => setShowModels(false)}
            />
          )}
        </div>
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
                }).catch(() => void 0);
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
      <div className="flow" ref={scrollRef} onScroll={(e) => {
        const el = e.currentTarget;
        setFollow(el.scrollTop + el.clientHeight >= el.scrollHeight - 32);
      }}>
        <div className="flow-inner">
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
            // DSH data-actions-reveal gate: the latest user row and the latest
            // turn tail hold 'always' (kept visible); earlier rows reveal on
            // hover / focus-within.
            // 轮折叠：长会话默认折叠早前轮（除最近 2 轮），折叠条点击展开。
            let lastUserIdx = -1;
            let lastTailIdx = -1;
            for (let i = 0; i < items.length; i++) {
              if (items[i].kind === "user") lastUserIdx = i;
              if (items[i].kind === "turn-tail") lastTailIdx = i;
            }
            const keyIdx = new Map(items.map((it, i) => [it.key, i] as const));
            const groups = groupTurns(items);
            const fold = foldDecision(groups.length);
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
              for (const item of g.items) {
                const idx = keyIdx.get(item.key) ?? -1;
                nodes.push(
                  <div
                    key={item.key}
                    className="chat-anchor-row"
                    ref={idx === 0 && !foldBarEmitted ? ((el: HTMLDivElement | null) => { olderAnchorRef.current = el; }) : undefined}
                  >
                    <Item
                      item={item}
                      latestUser={idx === lastUserIdx}
                      latestTurn={idx === lastTailIdx}
                      turnRunning={running}
                      onBranch={branchFrom}
                      sessionId={sessionId}
                      onContinue={() => {
                        void api.prompt({ sessionId, mode: "queue", content: [{ type: "text", text: t("继续") }] }).catch(() => void 0);
                      }}
                    />
                  </div>,
                );
              }
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
      {queuedItems.length > 0 && (
        <div className="queue-dock-wrap">
          <QueueDock sessionId={sessionId} items={queuedItems} />
        </div>
      )}
      <div className="session-bottom">
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

