import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, Pencil, ShieldCheck, Trash2, X } from "lucide-react";
import { ModelMenu } from "./ModelMenu";
import { WorkspacePill } from "./Sidebar";
import { api } from "../api";
import { useStore } from "../store";
import { t, tt, useT } from "../i18n";
import { useCompositionGuard } from "../useCompositionGuard";
import { Composer } from "./Composer";
import { HeroBrand } from "./HeroBrand";
import { Markdown } from "./Markdown";
import LoadingState from "./LoadingState";
import ThinkingState from "./ThinkingState";
import {
  IconApiOutline14,
  IconBrowseOutline16,
  IconBranchOutline16,
  IconCheckOutline16,
  IconChecklistOutline14,
  IconCodeOutline16,
  IconCopyOutline16,
  IconEditOutline16,
  IconQuestionOutline14,
  IconSearchOutline16,
  IconSkillOutline16,
  IconSparkle16,
} from "./Icons";
import type { SessionQueuedItem } from "../types";
import { planReviewOf } from "../planReview";
import { DiffBlock } from "./DiffBlock";
import { PlanReviewCard } from "./PlanReviewCard";
import { TurnUsagePop } from "./UsageMeter";
import { GoalBar } from "./GoalBar";
import { StatusCapsule, SubagentReadOnlyNotice } from "./StatusCapsule";
import { UserAttachments } from "./AttachmentImage";
import { groupTurns, foldDecision, type TurnGroup } from "../turnGroups";
import { blocksOf, textOf, textOfInjection } from "../session/eventText";
import { useSessionEvents } from "../session/useSessionEvents";
import { useSessionModels } from "../session/useSessionModels";
import { derivePath, parseTodos, type RenderItem, type WorkflowMember } from "../session/renderModel";
import {
  askSummary, basename, commandOf, formatClock, formatLatencySeconds,
  formatRunDuration, formatTokensPerSecond, prettyArgs, queueText, summarizeArgs,
} from "../session/format";


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

function Item({ item, latestUser, latestTurn, turnRunning, onBranch, onContinue, sessionId }: {
  item: RenderItem;
  latestUser: boolean;
  latestTurn: boolean;
  turnRunning: boolean;
  onBranch?: (forkSeq: number) => void;
  onContinue?: () => void;
  sessionId: string;
}) {
  if (item.kind === "user") {
    return (
      <div className="msg-block user" data-actions-reveal={latestUser ? "always" : "hover"}>
        <UserBubble text={textOf(item.event)} />
        <UserAttachments sessionId={sessionId} event={item.event} />
        {/* DSH user chrome: copy + clock only, NO branch, clock="start" */}
        <MessageMeta
          time={item.time}
          clockSide="start"
          copiedText={textOf(item.event)}
        />
      </div>
    );
  }
  if (item.kind === "assistant") {
    const t = textOf(item.event);
    if (!t) return null;
    const blocks = blocksOf(item.event);
    return (
      <div className="msg-block assistant">
        {blocks.think && <ThinkingState reasoning={blocks.think} running={false} />}
        <AgentMessage text={t} />
      </div>
    );
  }
  if (item.kind === "reasoning") {
    // Live reasoning-delta accumulation; exists only mid-turn until the final
    // assistant message replaces it with the settled trace.
    const text = item.output ?? "";
    if (!text) return null;
    return <ThinkingState reasoning={text} running={turnRunning} />;
  }
  if (item.kind === "turn-tail") {
    // DSH turn-tail chrome: produced files + copy / branch / clock("end") +
    // usage stats, in its own node so tool-only / interrupted turns keep them.
    const time = item.time;
    const meta = item.meta;
    const copiedText = item.event ? textOf(item.event) : "";
    const reason = item.endReason;
    const reasonKind = typeof reason === "object" && reason !== null ? (reason as { kind?: string }).kind : undefined;
    const errMsg = reasonKind === "error" ? (reason as { error?: { message?: string; code?: string } }).error?.message : undefined;
    const errCode = reasonKind === "error" ? (reason as { error?: { code?: string } }).error?.code : undefined;
    return (
      <div className="turn-tail" data-actions-reveal={latestTurn ? "always" : "hover"}>
        {reasonKind === "max-tokens" && (
          <div className="turn-issue">
            <span>{t("本轮达到 max tokens 上限，输出被截断")}</span>
            <button className="turn-issue-btn" onClick={onContinue}>{t("继续")}</button>
          </div>
        )}
        {reasonKind === "error" && (
          <div className="turn-issue" data-code={errCode ?? ""}>
            <span>
              {t("本轮失败")}
              {errMsg ? `：${errMsg}` : ""}
              {errCode === "MISSING_CREDENTIAL" ? `（${t("请在设置中配置 API Key 后重试")}）` : ""}
            </span>
          </div>
        )}
        <ProducedFiles paths={item.produced ?? []} />
        <MessageMeta
          time={time}
          clockSide="end"
          runMs={meta?.runMs}
          ttftMs={meta?.ttftMs ?? undefined}
          tokensPerSecond={meta?.tokensPerSecond ?? undefined}
          copiedText={copiedText}
          branch
          usage={item.usage}
          onBranch={item.forkSeq !== undefined ? () => onBranch?.(item.forkSeq!) : undefined}
        />
      </div>
    );
  }
  if (item.kind === "injection") {
    // 上下文注入折叠行：默认只露来源标签，展开看注入全文
    const text = item.event ? textOfInjection(item.event) : "";
    return <InjectionRow label={item.injectionLabel ?? "context"} text={text} />;
  }
  if (item.kind === "compaction") {
    return <CompactionCard summary={item.output ?? ""} shadowedTokens={item.args} />;
  }
  if (item.kind === "retry") {
    return <div className="retry-row"><StateDot state="warning" />{t("模型请求重试")}<span className="retry-detail">{item.output}</span></div>;
  }
  if (item.kind === "tool-call") {
    return (
      <ToolRow
        toolName={item.toolName ?? "tool"}
        args={item.args ?? ""}
        output={item.output}
        failed={item.failed}
        diffs={item.diffs}
      />
    );
  }
  if (item.kind === "command") {
    return <CommandCard name={item.toolName ?? "cmd"} args={item.args ?? ""} status={item.commandStatus ?? "running"} text={item.commandText} />;
  }
  if (item.kind === "workflow") {
    return <WorkflowCard name={item.args ?? t("工作流")} members={item.members ?? []} status={item.commandStatus} stopReason={item.commandText} />;
  }
  if (item.kind === "chunk" && item.output) {
    return <div className="msg assistant"><div className="text">{item.output}</div></div>;
  }
  return null;
}

/// User message: down-scaled bubble (deliberately quiet, weak layer).
function UserBubble({ text }: { text: string }) {
  return (
    <div className="user-bubble">{text}</div>
  );
}

/// Agent reply: pure text — NO bubble, NO element background (design rule).
function AgentMessage({ text }: { text: string }) {
  return (
    <div className="agent-message">
      <Markdown text={text} />
    </div>
  );
}

/** 常见工具名的中文标题；未收录的显示原名。 */
const TOOL_TITLE_ZH: Record<string, string> = {
  ask_user_question: "提问",
  todo_write: "任务",
  todos: "任务",
  str_replace_editor: "编辑",
  multiedit: "批量编辑",
  apply_patch: "应用补丁",
  glob: "查找文件",
  grep: "搜索内容",
  web_search: "联网搜索",
  web_fetch: "抓取网页",
  list_files: "列出文件",
};

/// One-line tool row — DSH ToolRow port: icon + name · summary + chevron,
/// expandable to reveal terminal output or raw arguments.
function ToolRow({ toolName, args, output, failed, diffs }: {
  toolName: string;
  args: string;
  output?: string;
  failed?: boolean;
  diffs?: import("../types").FileDiff[];
}) {
  const [open, setOpen] = useState(false);
  const todo = parseTodos(args);
  const isTodo = toolName === "todo_write" || toolName === "todos" || todo !== null;
  const isAsk = toolName === "ask_user_question" || toolName === "ask_user";
  const summary = isAsk ? askSummary(args) : todo !== null ? tt("{done}/{total} 已完成 · {active} 进行中 · {pending} 待处理", "{done}/{total} done · {active} in progress · {pending} pending", { done: todo.done, total: todo.total, active: todo.active, pending: todo.pending }) : summarizeArgs(args);
  const filePath = derivePath(toolName, args);
  const isBash = toolName === "bash" || toolName === "terminal-bash";
  const state = failed ? "error" : output !== undefined ? "done" : "running";
  const title = isTodo ? t("任务") : isAsk && state === "running" ? t("等待回答") : state === "running" ? t("正在执行") : t(TOOL_TITLE_ZH[toolName] ?? toolName);
  const expandable = (output !== undefined && output !== "") || args !== "" || isTodo || (!!diffs && diffs.length > 0);
  return (
    <div className={`tool-row${state === "error" ? " bad" : ""}`} data-state={state} data-tool={toolName}>
      <button
        className="tool-row-main"
        onClick={() => (expandable ? setOpen((v) => !v) : undefined)}
        aria-expanded={open}
      >
        <span className="tool-leading">
          {state === "error" ? <StateDot state="error" /> : state === "running" ? <StateDot state="running" /> : isTodo ? <IconChecklistOutline14 /> : <ToolIcon name={toolName} />}
        </span>
        <span className="tool-title">{title}</span>
        {summary && (
          <>
            <span className="tool-sep" aria-hidden="true" />
            {filePath && <FileLangIcon file={filePath} />}
            <span className="tool-summary">{summary}</span>
          </>
        )}
        {expandable && (
          <span className="tool-chevron" data-open={open ? "true" : "false"}>
            <ChevronDown size={14} />
          </span>
        )}
      </button>
      {expandable && (
        <div className="tool-collapse" data-open={open ? "true" : "false"}>
          <div className="tool-body">
            {isTodo && todo !== null ? (
              <TodoList todos={todo.items} />
            ) : isBash ? (
              <TerminalBlock command={commandOf(args)} output={output ?? ""} failed={failed} />
            ) : (
              <>
                {diffs && diffs.length > 0 && <DiffBlock diffs={diffs} />}
                {args && <div className="tool-io-label">{t("输入")}</div>}
                {args && <pre className="tool-io-text">{prettyArgs(args)}</pre>}
                {output !== undefined && output !== "" && (
                  <>
                    <div className="tool-io-label">{t("输出")}</div>
                    <pre className="tool-io-text">{output}</pre>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 命令卡：`/name args` 单行 + 状态点 + 结果文本（success 提示/error 展开）。
 *  对照官方 ui-conversation command 节点：命令是 log-only 的静默行，不抢消息流的戏。 */
function CommandCard({ name, args, status, text }: {
  name: string;
  args: string;
  status: "running" | "success" | "error";
  text?: string;
}) {
  const [open, setOpen] = useState(false);
  const hasBody = !!text;
  return (
    <div className="command-card" data-status={status}>
      <button
        type="button"
        className="command-main"
        onClick={() => (hasBody ? setOpen((v) => !v) : undefined)}
        aria-expanded={open}
      >
        <span className="command-leading">
          {status === "running" ? <StateDot state="running" /> : status === "error" ? <StateDot state="error" /> : <IconCheckOutline16 size={13} />}
        </span>
        <span className="command-name">/{name}</span>
        {args && <span className="command-args">{args}</span>}
        {status === "success" && !text && <span className="command-hint">{t("已完成")}</span>}
      </button>
      {hasBody && open && <div className="command-body">{text}</div>}
    </div>
  );
}

/** 工作流运行卡（5.4）：tool-workflow/* 事件驱动的嵌套成员卡。
 *  成员行=状态点+标签（+阶段），点击切入成员子会话；run-end 后定格终止原因。 */
function WorkflowCard({ name, members, status, stopReason }: {
  name: string;
  members: WorkflowMember[];
  status?: "running" | "success" | "error";
  stopReason?: string;
}) {
  const { openSession } = useStore();
  const [open, setOpen] = useState(true);
  const done = members.filter((m) => m.outcome).length;
  const failed = members.filter((m) => m.outcome === "failed").length;
  return (
    <div className="workflow-card" data-status={status ?? "running"}>
      <button type="button" className="workflow-main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="workflow-leading">
          {status === "success" ? <IconCheckOutline16 size={13} /> : status === "error" ? <StateDot state="error" /> : <StateDot state="running" />}
        </span>
        <span className="workflow-name">{name}</span>
        <span className="workflow-count">
          {tt("{done}/{total} 成员", "{done}/{total} members", { done, total: members.length })}
          {failed > 0 ? ` · ${tt("{n} 失败", "{n} failed", { n: failed })}` : ""}
        </span>
        {status === "error" && stopReason && <span className="workflow-reason">{stopReason}</span>}
        <ChevronDown size={13} className="injection-chev" data-open={open ? "true" : "false"} />
      </button>
      {open && (
        <div className="workflow-members">
          {members.map((m) => (
            <button
              key={m.seq}
              type="button"
              className="workflow-member"
              onClick={() => (m.childId ? openSession(m.childId) : undefined)}
              disabled={!m.childId}
            >
              <span className={`state-dot ${m.outcome === "failed" || m.outcome === "cancelled" ? "error" : m.outcome === "completed" ? "ok" : "running"}`} aria-hidden="true" />
              <span className="workflow-member-label">{m.label}</span>
              {m.phase && <span className="workflow-phase">{m.phase}</span>}
              <span className="workflow-outcome">{m.outcome ? tt(...(MEMBER_OUTCOME[m.outcome] ?? ["", ""])) : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


/** 工作流成员结果文案。 */
const MEMBER_OUTCOME: Record<string, [string, string]> = {
  completed: ["完成", "done"],
  failed: ["失败", "failed"],
  cancelled: ["已取消", "cancelled"],
};

/// Task list panel inside the todo row — DSH todo body list.
function TodoList({ todos }: { todos: Array<{ content: string; status: string }> }) {  return (
    <div className="todo-list">
      {todos.map((t, i) => (
        <div key={i} className={`todo-item ${t.status}`}>
          <span className="todo-bullet" aria-hidden="true">
            {t.status === "completed" ? <IconCheckOutline16 size={12} /> : <span className="todo-dot" />}
          </span>
          <span className="todo-content">{t.content}</span>
          <span className="todo-status">{t.status === "completed" ? tt("已完成", "Done") : t.status === "in_progress" ? tt("进行中", "In progress") : tt("待处理", "Pending")}</span>
        </div>
      ))}
    </div>
  );
}


/// Terminal port of DSH TerminalBlock (bash execution state).
function TerminalBlock({ command, output, failed }: { command: string; output: string; failed?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const MAX_LINES = 16;
  const lines = useMemo(() => output.split("\n"), [output]);
  const hidden = lines.length - MAX_LINES;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch { /* clipboard may be unavailable */ }
  };
  return (
    <div className="terminal-block" data-terminal="">
      <div className="terminal-header">
        <code className="terminal-command">$ {command}</code>
        <span className={`terminal-status${failed ? " error" : ""}`}>
          {failed ? t("退出码 非 0") : output && lines.length > MAX_LINES ? tt("{n} 行", "{n} lines", { n: hidden }) : ""}
        </span>
        <button type="button" className="terminal-copy" onClick={() => void copy()}>
          {copied ? <IconCheckOutline16 size={13} /> : <IconCopyOutline16 size={13} />}
          {copied ? t("复制成功") : t("复制")}
        </button>
      </div>
      {output !== "" && (
        <pre className="terminal-output">
          {(hidden > 0 && !expanded ? lines.slice(0, MAX_LINES) : lines).map((l, i) => (
            <span key={i} className="terminal-line">{l}{"\n"}</span>
          ))}
        </pre>
      )}
      {hidden > 0 && (
        <button className="terminal-expand" onClick={() => setExpanded((v) => !v)}>
          {expanded ? t("收起") : tt("… 其余 {n} 行", "… {n} more lines", { n: hidden })}
        </button>
      )}
    </div>
  );
}

/// Produced files lane — DSH ProducedFiles port (label + file chips).
function ProducedFiles({ paths }: { paths: string[] }) {
  if (paths.length === 0) return null;
  const shown = paths.slice(0, 6);
  const hidden = paths.length - shown.length;
  return (
    <div className="produced">
      <span className="produced-label">{t("产物")}</span>
      <div className="produced-row">
        {shown.map((p) => (
          <button type="button" key={p} className="produced-file" data-tip={p}>
            {basename(p)}
          </button>
        ))}
        {hidden > 0 && <span className="produced-more">{tt("+ {n} 个文件", "+{n} files", { n: hidden })}</span>}
      </div>
    </div>
  );
}

/// Message foot row — copy [+ branch] + clock · [用时 · 首 token · tok/s].
/// Mirrors DSH MessageIconActions: user chrome = copy + clock("start");
/// assistant turn tail = copy + branch + clock("end") + usage stats.
/// Quiet by default: reveals on hover (DSH actions affordance).
function MessageMeta({ time, runMs, ttftMs, tokensPerSecond, copiedText, clockSide = "end", branch = false, onBranch, usage }: {
  time?: number;
  runMs?: number;
  ttftMs?: number;
  tokensPerSecond?: number;
  copiedText: string;
  clockSide?: "start" | "end";
  branch?: boolean;
  onBranch?: () => void;
  usage?: import("../types").TokenUsage;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copiedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch { /* ignore */ }
  };
  const hasStats = runMs !== undefined || ttftMs !== undefined || tokensPerSecond !== undefined;
  const clock = time ? formatClock(time) : undefined;
  if (!clock && !hasStats && !branch) return null;
  const clockEl = (
    <TurnUsagePop usage={usage}>
      <span className="meta-clock">
        {clock}
        {runMs !== undefined && (
          <>
            <span className="meta-dot" aria-hidden="true">·</span>
            {t("用时")} {formatRunDuration(runMs)}
          </>
        )}
        {ttftMs !== undefined && (
          <>
            <span className="meta-dot" aria-hidden="true">·</span>
            {t("首 token")} {formatLatencySeconds(ttftMs)}
          </>
        )}
        {tokensPerSecond !== undefined && (
          <>
            <span className="meta-dot" aria-hidden="true">·</span>
            {formatTokensPerSecond(tokensPerSecond)} tok/s
          </>
        )}
      </span>
    </TurnUsagePop>
  );
  return (
    <div className="meta-actions">
      {clockSide === "start" ? clockEl : null}
      <button className="meta-action" title={copied ? t("复制成功") : t("复制")} aria-label={copied ? t("复制成功") : t("复制")} onClick={() => void copy()}>
        {copied ? <IconCheckOutline16 size={16} /> : <IconCopyOutline16 size={16} />}
      </button>
      {branch && (
        <button
          className="meta-action"
          data-tip={t("分支")}
          aria-label={t("分支")}
          onClick={onBranch}
        >
          <IconBranchOutline16 size={16} />
        </button>
      )}
      {clockSide === "end" ? clockEl : null}
    </div>
  );
}

/** 上下文注入折叠行（3.3）：默认一行来源标签，点击展开注入全文。 */
function InjectionRow({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="injection-row" data-open={open ? "true" : "false"}>
      <button type="button" className="injection-main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ChevronDown size={12} className="injection-chev" />
        <span>{t("上下文注入")}</span>
        <span className="injection-label">{label}</span>
      </button>
      {open && <pre className="injection-body">{text}</pre>}
    </div>
  );
}

/** 压缩标记卡（3.4）：compaction/summary 的流内标记，展开看压缩摘要。 */
function CompactionCard({ summary, shadowedTokens }: { summary: string; shadowedTokens?: string }) {
  const [open, setOpen] = useState(false);
  const n = shadowedTokens ? Number(shadowedTokens) : NaN;
  return (
    <div className="compaction-card" data-open={open ? "true" : "false"}>
      <button type="button" className="compaction-main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="compaction-ic" aria-hidden="true">⤺</span>
        <span>
          {t("已压缩更早的上下文")}
          {Number.isFinite(n) ? tt("（约 {n} tokens）", " (~{n} tokens)", { n }) : ""}
        </span>
        <ChevronDown size={12} className="injection-chev" />
      </button>
      {open && summary && (
        <div className="compaction-body">
          <Markdown text={summary} />
        </div>
      )}
    </div>
  );
}

function StateDot({ state }: { state: "running" | "error" | "warning" | "ok" }) {
  return <span className={`state-dot ${state}`} aria-hidden="true" />;
}

/// Variant leading icons — DSH figma table (all glyphs render at 14 inside the
/// 16px leading box): search / read(browse) / bash(api) / write-edit(edit) /
/// code / question for unknown. Ported from ui-tool GenericToolCard.
/// Variant leading icons — 对齐官方 tool-call-model 的 TOOL_VARIANTS（figma 表，
/// 所有 glyph 在 16px 前导盒内按 14 渲染）：bash/pwsh → api；read 家族（含
/// web_fetch、read_image、cordis inspect）→ browse；search 家族（web_search/
/// grep/glob）→ search；write/edit → edit；run_code → code；skill → 专用图标；
/// 未分类（含 jobs/goal/subagent/ralph 等）→ sparkle。ask_user_question 保留
/// 问号：与等待回答行语义直接对应。
function ToolIcon({ name }: { name: string }) {
  switch (name) {
    case "bash":
    case "terminal-bash":
    case "pwsh":
      return <IconApiOutline14 size={14} />;
    case "write":
    case "edit":
    case "str_replace_editor":
    case "patch":
    case "multiedit":
    case "apply_patch":
      return <IconEditOutline16 size={14} />;
    case "read":
    case "read_file":
    case "file_read":
    case "read_image":
    case "web_fetch":
    case "fetch":
    case "cordis_package_inspect":
    case "cordis_runtime_inspect":
      return <IconBrowseOutline16 size={14} />;
    case "web_search":
    case "grep":
    case "glob":
    case "search":
      return <IconSearchOutline16 size={14} />;
    case "run_code":
    case "code":
    case "code_execute":
    case "code_interpreter":
      return <IconCodeOutline16 size={14} />;
    case "skill":
      return <IconSkillOutline16 size={14} />;
    case "ask_user_question":
    case "ask_user":
      return <IconQuestionOutline14 size={14} />;
    default:
      return <IconSparkle16 size={14} />;
  }
}

/// 文件语言徽标 — 文件工具行按扩展名显示彩色语言图标（DSH 编辑行同款）：
/// tsx/jsx 画 React 原子标，其余用 VS Code 风格的彩色缩写徽标。
const LANG_BADGES: Record<string, { bg: string; fg?: string; label: string }> = {
  ts: { bg: "#3178C6", label: "TS" },
  js: { bg: "#F7DF1E", fg: "#323330", label: "JS" },
  mjs: { bg: "#F7DF1E", fg: "#323330", label: "JS" },
  cjs: { bg: "#F7DF1E", fg: "#323330", label: "JS" },
  css: { bg: "#663399", label: "CSS" },
  scss: { bg: "#CF649A", label: "SCS" },
  less: { bg: "#2B5E91", label: "LES" },
  json: { bg: "#E8A33D", fg: "#26221E", label: "{}" },
  md: { bg: "#519ABA", label: "MD" },
  txt: { bg: "#6E7681", label: "TXT" },
  py: { bg: "#3572A5", label: "PY" },
  rs: { bg: "#CE4A2F", label: "RS" },
  go: { bg: "#00ADD8", label: "GO" },
  rb: { bg: "#CC342D", label: "RB" },
  php: { bg: "#777BB4", label: "PHP" },
  java: { bg: "#B07219", label: "JAVA" },
  swift: { bg: "#F05138", label: "SW" },
  vue: { bg: "#41B883", label: "VUE" },
  html: { bg: "#E34C26", label: "<>" },
  sh: { bg: "#89E051", fg: "#243018", label: "$" },
  bash: { bg: "#89E051", fg: "#243018", label: "$" },
  zsh: { bg: "#89E051", fg: "#243018", label: "$" },
  yml: { bg: "#CB171E", label: "YML" },
  yaml: { bg: "#CB171E", label: "YML" },
  toml: { bg: "#9C4221", label: "TML" },
  sql: { bg: "#DD6B20", label: "SQL" },
};

function ReactLangIcon() {
  return (
    <svg className="lang-badge" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#61DAFB" strokeWidth="1.4" aria-hidden="true">
      <circle cx="12" cy="12" r="2.1" fill="#61DAFB" stroke="none" />
      <ellipse cx="12" cy="12" rx="10" ry="4.2" />
      <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(120 12 12)" />
    </svg>
  );
}

function FileLangIcon({ file }: { file: string }) {
  const name = file.split(/[/\\]/).pop() ?? file;
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (ext === "tsx" || ext === "jsx") return <ReactLangIcon />;
  const badge = LANG_BADGES[ext];
  if (!badge) return null;
  return (
    <span className="lang-badge" style={{ background: badge.bg, color: badge.fg ?? "#FFFFFF" }} aria-hidden="true">
      {badge.label}
    </span>
  );
}

function ApprovalCard({ approvalId, rpcId, sessionId, toolName, reason }: { approvalId: string; rpcId?: string; sessionId: string; toolName: string; reason?: string }) {
  const [done, setDone] = useState(false);
  const answer = async (outcome: "allowed-once" | "rejected") => {
    if (!rpcId) return;
    try {
      await api.answerApproval({ rpcId, sessionId, approvalId, outcome });
      setDone(true);
    } catch {
      // ignore; card stays until approval/resolved
    }
  };
  return (
    <div className="approval-card">
      <div className="head">
        <ShieldCheck size={15} />
        {t("请求授权")}
      </div>
      <div className="cmd">{reason || toolName}</div>
      <div className="actions">
        <button className="btn-plain" disabled={done || !rpcId} onClick={() => void answer("rejected")}>
          <X size={13} style={{ verticalAlign: -2 }} /> {t("拒绝")}
        </button>
        <button className="btn-primary" disabled={done || !rpcId} onClick={() => void answer("allowed-once")}>
          {t("允许一次")}
        </button>
      </div>
    </div>
  );
}

/** 意图澄清卡片 — 官方 ui-user-questions QuestionComposer 的卡片化移植。
 *  单选题点击即锁定并推进（最后一题自动提交整批答案）；多选题勾选后用
 *  底部按钮推进；每题可跳过（selected: []）；关闭 = ASK_CANCELLED。
 *  应答回传请求信封上的 rpcId，卡片由 question/resolved 帧清除。 */
function QuestionCard({ rpcId, sessionId, questions }: {
  rpcId: string;
  sessionId: string;
  questions: Array<{ id: string; question: string; header?: string; detail?: string; options?: Array<{ label: string; description?: string }>; multiSelect?: boolean }>;
}) {
  const [page, setPage] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, { selected: string[]; custom?: string }>>({});
  const [custom, setCustom] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const ime = useCompositionGuard();
  const q = questions[Math.min(page, questions.length - 1)];
  if (!q) return null;
  const multi = q.multiSelect === true;
  const options = q.options ?? [];
  const draft = drafts[q.id];
  const isLast = page >= questions.length - 1;

  const setDraft = (next: { selected: string[]; custom?: string }) => {
    setDrafts((prev) => ({ ...prev, [q.id]: next }));
  };

  const submitAll = async (final: Record<string, { selected: string[]; custom?: string }>) => {
    setSubmitting(true);
    try {
      await api.answerQuestion({
        rpcId,
        sessionId,
        answers: questions.map((item) => {
          const d = final[item.id] ?? { selected: [] };
          return { id: item.id, selected: d.selected, ...(d.custom ? { custom: d.custom } : {}) };
        }),
      });
      // 卡片由 question/resolved 帧负责移除；这里只防重复提交。
    } catch {
      setSubmitting(false); // 引擎不可达：留在卡片上可重试
    }
  };

  const advanceOrSubmit = async (next: { selected: string[]; custom?: string }) => {
    const final = { ...drafts, [q.id]: next };
    setDrafts(final);
    if (isLast) {
      await submitAll(final);
    } else {
      setCustom("");
      setPage((p) => p + 1);
    }
  };

  const pick = async (label: string) => {
    if (multi) {
      const sel = draft?.selected ?? [];
      const next = sel.includes(label) ? sel.filter((s) => s !== label) : [...sel, label];
      setDraft({ selected: next });
    } else {
      await advanceOrSubmit({ selected: [label] });
    }
  };

  const skip = () => void advanceOrSubmit({ selected: [] });
  const sendCustom = () => {
    const text = custom.trim();
    if (!text) return;
    void advanceOrSubmit(multi ? { selected: draft?.selected ?? [], custom: text } : { selected: [], custom: text });
  };
  const cancel = async () => {
    setSubmitting(true);
    try { await api.cancelQuestion(rpcId); } catch { setSubmitting(false); }
  };

  return (
    <div className="question-card">
      <div className="head">
        <IconQuestionOutline14 size={14} />
        {t("澄清一下")}
        {questions.length > 1 && <span className="pager">{page + 1}/{questions.length}</span>}
        <button className="q-close" data-tip={t("取消提问")} disabled={submitting} onClick={() => void cancel()}>
          <X size={13} />
        </button>
      </div>
      {q.header && <div className="q-header">{q.header}</div>}
      <div className="q-text">{q.question}</div>
      {q.detail && <div className="q-detail">{q.detail}</div>}
      {options.length > 0 && (
        <div className="q-options">
          {options.map((o) => {
            const active = (draft?.selected ?? []).includes(o.label);
            return (
              <button
                key={o.label}
                className={`q-option${active ? " active" : ""}`}
                disabled={submitting}
                onClick={() => void pick(o.label)}
              >
                <span className="q-option-mark" aria-hidden="true" />
                <span className="q-option-body">
                  <span className="q-option-label">{o.label}</span>
                  {o.description && <span className="q-option-desc">{o.description}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="q-custom">
        <input
          placeholder={t("自定义回答…")}
          value={custom}
          disabled={submitting}
          onChange={(e) => setCustom(e.target.value)}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          onKeyDown={(e) => {
            if (ime.swallow(e)) return;
            if (e.key === "Enter") {
              e.preventDefault();
              sendCustom();
            }
          }}
        />
      </div>
      <div className="actions">
        <button className="btn-plain" disabled={submitting} onClick={skip}>
          {t("跳过此题")}
        </button>
        {multi && (
          <button
            className="btn-primary"
            disabled={submitting || (draft?.selected ?? []).length === 0}
            onClick={() => void advanceOrSubmit({ selected: draft?.selected ?? [], custom: custom.trim() || undefined })}
          >
            {isLast ? t("提交") : t("下一题")}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- derivations ----------
//
// Payload accessors are typed against SessionEvent's discriminated union, so
// `switch (event.type)` narrows `event.data` — no `as any`. Unknown event
// types fall through the default branch below.


/** 排队消息卡（官方 QueueDock 式）：挂在会话框上方，行内 立即/编辑/删除。
 *  数据来自 store.queues（session/queue 帧），操作走 session.updateQueue，
 *  引擎应用后广播新快照，卡片随之刷新。 */
function QueueDock({ sessionId, items }: { sessionId: string; items: SessionQueuedItem[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const ime = useCompositionGuard();
  const mutate = async (itemId: string, action: Parameters<typeof api.updateQueue>[0]["action"]) => {
    try {
      await api.updateQueue({ sessionId, itemId, action });
    } catch (err) {
      alert(tt("排队消息操作失败：{m}", "Queue update failed: {m}", { m: (err as Error).message }));
    }
  };
  const saveEdit = (itemId: string) => {
    if (!draft.trim()) return;
    void mutate(itemId, { kind: "edit", content: [{ type: "text", text: draft.trim() }] });
    setEditingId(null);
  };
  return (
    <div className="queue-dock">
      {items.map((item) => {
        const text = queueText(item);
        const editing = editingId === item.id;
        return (
          <div className="queue-row" key={item.id}>
            <span className="queue-handle" aria-hidden="true"><GripVertical size={13} /></span>
            {editing ? (
              <>
                <input
                  className="queue-edit"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onCompositionStart={ime.onCompositionStart}
                  onCompositionEnd={ime.onCompositionEnd}
                  onKeyDown={(e) => {
                    if (ime.swallow(e)) return;
                    if (e.key === "Enter") saveEdit(item.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
                <div className="queue-actions">
                  <button className="queue-btn" data-tip={t("保存排队消息")} onClick={() => saveEdit(item.id)}>
                    <IconCheckOutline16 size={14} />
                  </button>
                  <button className="queue-btn" data-tip={t("取消编辑")} onClick={() => setEditingId(null)}>
                    <X size={14} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="queue-text" data-tip={text}>{text}</span>
                <div className="queue-actions">
                  <button className="queue-now" title={t("立即插队执行")} onClick={() => void mutate(item.id, { kind: "steer" })}>
                    <ArrowUp size={13} />
                    {t("立即")}
                  </button>
                  <button className="queue-btn" title={t("编辑排队消息")} onClick={() => { setEditingId(item.id); setDraft(text); }}>
                    <Pencil size={13} />
                  </button>
                  <button className="queue-btn" title={t("删除排队消息")} onClick={() => void mutate(item.id, { kind: "remove" })}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
