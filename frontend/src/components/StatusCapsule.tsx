import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlarmClock, ArrowRight, Bot, ChevronDown, ChevronUp, CircleCheck, FileDiff, Flag,
  History, RefreshCw, Square,
} from "lucide-react";
import { api } from "../api";
import { gitStatus } from "../host";
import { useStore } from "../store";
import { t, tt } from "../i18n";
import { CapsuleGitSection } from "./CapsuleGitSection";
import { CapsuleSection } from "./CapsuleSection";
import { CapsuleTodoSection } from "./CapsuleTodoSection";
import { capsulePill, classifyJobs, goalPhasePair, statusPanelHasContent, todoView, type CapsuleTodo } from "./capsuleModel";
import { formatElapsed } from "../session/format";
import type { GitStatus, GoalProjection, JobView, ScheduleRecord, SubagentListEntry } from "../types";

// 会话状态胶囊：头部右上角的聚合信息框，收编原 JobsMenu/ScheduleMenu/
// SubagentLineage 三个 chip。收起态是一条优先级回落链（顺序与理由见
// capsuleModel 的 capsulePill），点击展开为分区面板；无内容可画才隐藏。
// 派生与优先级全在 capsuleModel（纯函数、可测），本组件只负责取数与渲染。
// Git 数据来自壳层 run-git 桥消息（引擎无 git 能力）。

type ChildEntry = Extract<SubagentListEntry, { kind: "child" }>;

const JOB_STATUS: Record<string, [string, string]> = {
  running: ["运行中", "running"],
  stopping: ["停止中", "stopping"],
  completed: ["已完成", "completed"],
  killed: ["已终止", "killed"],
  failed: ["失败", "failed"],
};

function fmtScheduleWhen(r: ScheduleRecord): string {
  if (r.kind === "every") return tt("每 {n} 分钟", "every {n} min", { n: Math.round((r.everySeconds ?? 300) / 60) });
  if (typeof r.afterSeconds === "number") return tt("{n} 分钟后", "in {n} min", { n: Math.max(1, Math.round(r.afterSeconds / 60)) });
  if (r.scheduledAt) {
    return new Date(r.scheduledAt).toLocaleString(undefined, { month: "numeric", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  return "—";
}

/** 后台任务一行：状态点 + 名称 + 类型/状态 + 运行时长（已结束的用 finishedAt 定格）。 */
function JobRow({ job, now }: { job: JobView; now: number }) {
  return (
    <div className="capsule-row">
      <span className={`state-dot ${job.status === "failed" ? "error" : job.status === "running" ? "running" : "ok"}`} aria-hidden="true" />
      <span className="capsule-row-text">{job.label}</span>
      <span className="capsule-row-meta">
        {job.kind} · {tt(...(JOB_STATUS[job.status] ?? JOB_STATUS.running!))}
        {job.detail ? ` · ${job.detail}` : ""}
      </span>
      <span className="capsule-row-meta">{formatElapsed((job.finishedAt ?? now) - job.startedAt)}</span>
    </div>
  );
}

export function StatusCapsule({ sessionId, scheduleRecords }: { sessionId: string; scheduleRecords: ScheduleRecord[] }) {
  const { sessions, jobsBySession, openSession, wsOfSession, workspaces, activeWorkspaceId, subscribeControl } = useStore();
  const [open, setOpen] = useState(false);
  // control 流实时帧优先（undefined=尚无帧，用 store 投影基线），照 SessionView goal 模式
  const [liveTodos, setLiveTodos] = useState<CapsuleTodo[] | null | undefined>(undefined);
  const [children, setChildren] = useState<ChildEntry[]>([]);
  const [diag, setDiag] = useState(false);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [showEndedJobs, setShowEndedJobs] = useState(false);
  const [now, setNow] = useState(Date.now());
  const ref = useRef<HTMLDivElement>(null);

  const running = sessions.find((s) => s.sessionId === sessionId)?.running ?? false;
  const jobs = jobsBySession.get(sessionId) ?? [];
  const jobSplit = classifyJobs(jobs);
  const storeTodos = sessions.find((s) => s.sessionId === sessionId)?.projections?.values?.todos as CapsuleTodo[] | null | undefined;
  const todos = liveTodos ?? storeTodos;
  const goal = (sessions.find((s) => s.sessionId === sessionId)?.projections?.values?.goal as GoalProjection | null | undefined)?.goal;

  // todo 投影实时帧（control 流 projection key=todos 整表推送）快于 3s 轮询
  useEffect(() => subscribeControl((frame) => {
    if (frame.type !== "projection") return;
    if (frame.sessionId === sessionId && frame.key === "todos") {
      setLiveTodos((frame.value ?? null) as CapsuleTodo[] | null);
    }
  }), [sessionId, subscribeControl]);

  // 子智能体目录：subagent.list 是拉取式 RPC，挂载 + 展开时刷，运行中低频轮询
  const loadChildren = useCallback(() => {
    void api.subagentList({ parentSessionId: sessionId }).then((r) => {
      const list = r.entries ?? [];
      setChildren(list.filter((e): e is ChildEntry => e.kind === "child"));
      setDiag(list.some((e) => e.kind === "diagnostic"));
    }).catch(() => setChildren([])); // 能力缺失/引擎忙 → 无谱系
  }, [sessionId]);
  useEffect(loadChildren, [loadChildren]);
  useEffect(() => {
    if (!open && !running) return;
    const iv = setInterval(loadChildren, 10000);
    return () => clearInterval(iv);
  }, [open, running, loadChildren]);

  // Git：壳层聚合，挂载 + 10s 低频轮询（仅桌面壳且有工作区路径时有值）
  const wsId = wsOfSession.get(sessionId) ?? activeWorkspaceId;
  const wsPath = workspaces.find((w) => w.workspaceId === wsId)?.path;
  const loadGit = useCallback(() => {
    if (!wsPath) return;
    void gitStatus(wsPath).then(setGit);
  }, [wsPath]);
  useEffect(loadGit, [loadGit]);
  useEffect(() => {
    if (!wsPath) return;
    const iv = setInterval(loadGit, 10000);
    return () => clearInterval(iv);
  }, [wsPath, loadGit]);

  const childRunning = (c: ChildEntry) => !!sessions.find((s) => s.sessionId === c.id)?.running || c.activity === "running";
  const runningChildren = children.filter(childRunning).length;

  // 面板展开且有活跃任务时，秒级时钟刷新运行时长
  useEffect(() => {
    if (!open || jobSplit.live.length === 0) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [open, jobSplit.live.length]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const interrupt = async (childId: string) => {
    setBusy(true);
    try {
      await api.subagentInterrupt({ parentSessionId: sessionId, childSessionId: childId });
      loadChildren();
    } catch { /* 引擎忙或不可中断：行上状态点反映实况 */ }
    setBusy(false);
  };

  const todo = todoView(todos);
  const runningCount = runningChildren + jobSplit.live.length;
  const endedCount = jobSplit.ended.length + (children.length - runningChildren);
  const hasContent = statusPanelHasContent({
    todos, goal, git, scheduleRecords,
    jobCount: jobs.length,
    subagentEntryCount: children.length,
    runningCount,
  });
  if (!open && !hasContent) return null;
  const pill = capsulePill({
    todos, goal, git, runningCount, endedCount, scheduleRecords, fmtScheduleWhen,
  });

  return (
    <div className="capsule-wrap" ref={ref}>
      {pill && (
        <button type="button" className="capsule-trigger" data-tip={t("摘要")} data-open={open ? "true" : "false"} onClick={() => setOpen((v) => !v)}>
          {pill.kind === "todo" && <>
            <ArrowRight size={13} />
            <span className="capsule-pill-text">{pill.text}</span>
            <span className="capsule-pill-meta">{pill.done}/{pill.total}</span>
          </>}
          {pill.kind === "goal" && <>
            {pill.done ? <CircleCheck size={13} className="capsule-check" /> : <Flag size={13} />}
            <span className="capsule-pill-text">{pill.title}</span>
          </>}
          {pill.kind === "git" && <>
            <FileDiff size={13} />
            <span className="capsule-pill-meta"><b className="capsule-add">+{pill.additions}</b> <b className="capsule-del">−{pill.deletions}</b></span>
          </>}
          {pill.kind === "todoDone" && <>
            <CircleCheck size={13} className="capsule-check" />
            <span className="capsule-pill-text">{pill.text}</span>
          </>}
          {pill.kind === "running" && <>
            <Bot size={13} />
            <span>{tt("{n} 运行中", "{n} running", { n: pill.count })}</span>
            <span className="capsule-live" aria-hidden="true" />
          </>}
          {pill.kind === "schedule" && <>
            <AlarmClock size={13} />
            <span className="capsule-pill-text">{pill.prompt}</span>
            <span className="capsule-pill-meta">{pill.when}</span>
          </>}
          {pill.kind === "ended" && <>
            <History size={13} />
            <span className="capsule-pill-meta">{tt("{n} 项已结束", "{n} ended", { n: pill.count })}</span>
          </>}
        </button>
      )}
      {open && (
        <div className="capsule-panel">
          <div className="capsule-head">
            <span className="capsule-title">{t("摘要")}</span>
            <button type="button" className="capsule-fold" data-tip={t("收起")} onClick={() => setOpen(false)}>
              <ChevronUp size={14} />
            </button>
          </div>
          {goal && (
            <CapsuleSection title={t("目标")}>
              <div className="capsule-row">
                <span className={`state-dot ${goal.phase === "active" ? "running" : goal.phase === "complete" ? "ok" : "warning"}`} aria-hidden="true" />
                <span className="capsule-row-text">{goal.objective}</span>
                <span className="capsule-row-meta">{tt(...goalPhasePair(goal.phase))}</span>
              </div>
            </CapsuleSection>
          )}
          {todo.total > 0 && (
            <CapsuleSection title={t("任务与计划")} trailing={`${todo.done}/${todo.total}`} scroll="tall">
              <CapsuleTodoSection todo={todo} />
            </CapsuleSection>
          )}
          {children.length > 0 && (
            <CapsuleSection
              title={t("子智能体")}
              trailing={
                <button type="button" className="capsule-refresh" data-tip={t("刷新")} onClick={loadChildren}>
                  <RefreshCw size={11} />
                </button>
              }
            >
              {children.map((c) => {
                const live = childRunning(c);
                const modeLabel = c.mode === "continuable" ? t("可续") : t("一次性");
                return (
                  <div key={c.id} className="capsule-row">
                    <button type="button" className="capsule-row-main" onClick={() => { setOpen(false); openSession(c.id); }}>
                      <span className={`capsule-dot${live ? " live" : ""}`} aria-hidden="true" />
                      <span className="capsule-row-text">{c.label ?? c.id.slice(0, 8)}</span>
                      <span className="capsule-row-meta">{modeLabel}{live ? ` · ${t("运行中")}` : ""}</span>
                    </button>
                    {live && c.mode === "continuable" && (
                      <button type="button" className="capsule-stop" data-tip={t("中断子智能体")} disabled={busy} onClick={() => void interrupt(c.id)}>
                        <Square size={11} />
                      </button>
                    )}
                  </div>
                );
              })}
              {diag && <div className="capsule-note">{t("部分子会话状态不可读")}</div>}
            </CapsuleSection>
          )}
          {git && git.files > 0 && (
            <CapsuleSection title={t("Git 工具")} scroll="none">
              <CapsuleGitSection wsPath={wsPath} git={git} onRefresh={loadGit} />
            </CapsuleSection>
          )}
          {(scheduleRecords.length > 0 || jobs.length > 0) && (
            <CapsuleSection title={t("提醒与自动化")}>
              {scheduleRecords.map((r) => (
                <div key={r.id} className="capsule-row">
                  <span className="state-dot running" aria-hidden="true" />
                  <span className="capsule-row-text">{r.prompt}</span>
                  <span className="capsule-row-meta">{fmtScheduleWhen(r)}</span>
                </div>
              ))}
              {/* 还在跑的列在区里；已结束的折一行（与 ZCode 把"已结束"另给落点同款处理） */}
              {jobSplit.live.map((j) => <JobRow key={j.id} job={j} now={now} />)}
              {jobSplit.ended.length > 0 && (
                <>
                  <button type="button" className="capsule-sec-toggle" onClick={() => setShowEndedJobs((v) => !v)}>
                    <ChevronDown size={12} style={showEndedJobs ? undefined : { transform: "rotate(-90deg)" }} />
                    {tt("已结束 {n} 项", "Ended {n}", { n: jobSplit.ended.length })}
                  </button>
                  {showEndedJobs && jobSplit.ended.map((j) => <JobRow key={j.id} job={j} now={now} />)}
                </>
              )}
            </CapsuleSection>
          )}
        </div>
      )}
    </div>
  );
}

/** 子会话只读说明（origin==='subagent' 的会话视图 composer 替代）。 */
export function SubagentReadOnlyNotice({ parentSessionId }: { parentSessionId?: string }) {
  const { sessions, openSession } = useStore();
  const parentTitle = (sessions.find((s) => s.sessionId === parentSessionId)?.projections?.values?.title as string | undefined)
    ?? t("打开父会话");
  return (
    <div className="subagent-readonly" role="status">
      <strong>{t("这是子智能体会话")}</strong>
      <span>{t("目录寻址的子会话在此只读；继续对话请回到父会话。")}</span>
      {parentSessionId && (
        <button type="button" className="subagent-parent-link" onClick={() => openSession(parentSessionId)}>
          {parentTitle}
        </button>
      )}
    </div>
  );
}
