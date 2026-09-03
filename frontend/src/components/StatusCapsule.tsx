import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlarmClock, ArrowRight, ChevronDown, ChevronUp, Circle,
  CircleCheck, GitBranch, ListTodo, RefreshCw, Square, Users,
} from "lucide-react";
import { api } from "../api";
import { gitStatus } from "../host";
import { useStore } from "../store";
import { t, tt } from "../i18n";
import { CapsuleGitSection } from "./CapsuleGitSection";
import { capsuleCategory, todoStats, type CapsuleTodo } from "./capsuleModel";
import type { GitStatus, ScheduleRecord, SubagentListEntry } from "../types";

// 会话状态胶囊：头部右上角的聚合信息框，收编原 JobsMenu/ScheduleMenu/
// SubagentLineage 三个 chip。收起态按当前运行状态固定显示一类（优先级见
// capsuleModel），点击展开为分区面板（任务/子代理/Git 改动/提醒与自动化）；
// 全空自动隐藏。Git 数据来自壳层 run-git 桥消息（引擎无 git 能力）。

type ChildEntry = Extract<SubagentListEntry, { kind: "child" }>;

const JOB_STATUS: Record<string, [string, string]> = {
  running: ["运行中", "running"],
  stopping: ["停止中", "stopping"],
  completed: ["已完成", "completed"],
  killed: ["已终止", "killed"],
  failed: ["失败", "failed"],
};

function elapsed(startedAt: number, finishedAt: number | undefined, now: number): string {
  const ms = (finishedAt ?? now) - startedAt;
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return tt("{s}秒", "{s}s", { s });
  const m = Math.floor(s / 60);
  if (m < 60) return tt("{m}分{s}秒", "{m}m{s}s", { m, s: s % 60 });
  return tt("{h}小时", "{h}h", { h: Math.floor(m / 60) });
}

function fmtScheduleWhen(r: ScheduleRecord): string {
  if (r.kind === "every") return tt("每 {n} 分钟", "every {n} min", { n: Math.round((r.everySeconds ?? 300) / 60) });
  if (typeof r.afterSeconds === "number") return tt("{n} 分钟后", "in {n} min", { n: Math.max(1, Math.round(r.afterSeconds / 60)) });
  if (r.scheduledAt) {
    return new Date(r.scheduledAt).toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  return "—";
}

export function StatusCapsule({ sessionId, scheduleRecords }: { sessionId: string; scheduleRecords: ScheduleRecord[] }) {
  const { sessions, jobsBySession, openSession, wsOfSession, workspaces, activeWorkspaceId, subscribeMux } = useStore();
  const [open, setOpen] = useState(false);
  // mux 实时帧优先（undefined=尚无帧，用 store 投影基线），照 SessionView goal 模式
  const [liveTodos, setLiveTodos] = useState<CapsuleTodo[] | null | undefined>(undefined);
  const [children, setChildren] = useState<ChildEntry[]>([]);
  const [diag, setDiag] = useState(false);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [now, setNow] = useState(Date.now());
  const ref = useRef<HTMLDivElement>(null);

  const running = sessions.find((s) => s.sessionId === sessionId)?.running ?? false;
  const jobs = jobsBySession.get(sessionId) ?? [];
  const liveJobs = jobs.filter((j) => j.status === "running" || j.status === "stopping");
  const storeTodos = sessions.find((s) => s.sessionId === sessionId)?.projections?.values?.todos as CapsuleTodo[] | null | undefined;
  const todos = liveTodos ?? storeTodos;

  // todo 投影实时帧（session/projection key=todos 整表推送）快过 3s 轮询
  useEffect(() => subscribeMux((frame) => {
    if (frame.type !== "session/projection") return;
    const p = frame as import("../types").ProjectionFrame;
    if (p.sessionId === sessionId && p.key === "todos") {
      setLiveTodos((p.value ?? null) as CapsuleTodo[] | null);
    }
  }), [sessionId, subscribeMux]);

  // 子代理目录：subagent.list 是拉取式 RPC，挂载 + 展开时刷，运行中低频轮询
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

  // 面板展开且有活跃任务时，秒级时钟刷新运行时长
  useEffect(() => {
    if (!open || liveJobs.length === 0) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [open, liveJobs.length]);

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
      await api.subagentInterrupt({ parentSessionId: sessionId, childSessionId: childId, mode: "continuable" });
      loadChildren();
    } catch { /* 引擎忙或不可中断：行上状态点反映实况 */ }
    setBusy(false);
  };

  const runningChildren = children.filter((c) => sessions.find((s) => s.sessionId === c.id)?.running || c.activity === "running").length;
  const cat = capsuleCategory({
    agentsRunning: runningChildren + liveJobs.length,
    todos, git,
    scheduleRecords,
    fmtScheduleWhen,
  });
  if (!open && !cat) return null;

  const stats = todoStats(todos);
  const pending = (todos ?? []).filter((x) => x.status === "pending");
  const completed = (todos ?? []).filter((x) => x.status === "completed");

  return (
    <div className="capsule-wrap" ref={ref}>
      {cat && (
        <button type="button" className="capsule-trigger" data-open={open ? "true" : "false"} onClick={() => setOpen((v) => !v)}>
          {cat.kind === "agents" && <>
            <Users size={13} />
            <span>{tt("{n} 运行中", "{n} running", { n: cat.count })}</span>
            <span className="capsule-live" aria-hidden="true" />
          </>}
          {cat.kind === "todo" && <>
            <ArrowRight size={13} />
            <span className="capsule-pill-text">{cat.active}</span>
            <span className="capsule-pill-meta">{cat.done}/{cat.total}</span>
          </>}
          {cat.kind === "git" && <>
            <GitBranch size={13} />
            <span className="capsule-pill-meta"><b className="capsule-add">+{cat.additions}</b> <b className="capsule-del">−{cat.deletions}</b></span>
          </>}
          {cat.kind === "schedule" && <>
            <AlarmClock size={13} />
            <span className="capsule-pill-text">{cat.prompt}</span>
            <span className="capsule-pill-meta">{cat.when}</span>
          </>}
        </button>
      )}
      {open && (
        <div className="capsule-panel">
          <div className="capsule-head">
            <span className="capsule-title">{t("会话状态")}</span>
            <button type="button" className="capsule-fold" title={t("收起")} onClick={() => setOpen(false)}>
              <ChevronUp size={14} />
            </button>
          </div>
          {(todos ?? []).length > 0 && (
            <div className="capsule-sec">
              <div className="capsule-sec-name"><ListTodo size={12} />{t("任务与计划")}</div>
              {stats.active && (
                <div className="capsule-row">
                  <ArrowRight size={13} />
                  <span className="capsule-row-text">{stats.active.content}</span>
                </div>
              )}
              {pending.map((p) => (
                <div key={p.content} className="capsule-row">
                  <Circle size={12} />
                  <span className="capsule-row-text">{p.content}</span>
                </div>
              ))}
              {completed.length > 0 && (
                <>
                  <button type="button" className="capsule-sec-toggle" onClick={() => setShowDone((v) => !v)}>
                    <ChevronDown size={12} style={showDone ? undefined : { transform: "rotate(-90deg)" }} />
                    {tt("已完成 {n} 项", "Completed {n}", { n: completed.length })}
                  </button>
                  {showDone && completed.map((c) => (
                    <div key={c.content} className="capsule-row">
                      <CircleCheck size={13} className="capsule-check" />
                      <span className="capsule-row-text capsule-row-done">{c.content}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
          {children.length > 0 && (
            <div className="capsule-sec">
              <div className="capsule-sec-name">
                <Users size={12} />{t("子代理")}
                <button type="button" className="capsule-refresh" title={t("刷新")} onClick={loadChildren}>
                  <RefreshCw size={11} />
                </button>
              </div>
              {children.map((c) => {
                const childRunning = !!sessions.find((s) => s.sessionId === c.id)?.running || c.activity === "running";
                const modeLabel = c.mode === "continuable" ? t("可续") : t("一次性");
                return (
                  <div key={c.id} className="capsule-row">
                    <button type="button" className="capsule-row-main" onClick={() => { setOpen(false); openSession(c.id); }}>
                      <span className={`capsule-dot${childRunning ? " live" : ""}`} aria-hidden="true" />
                      <span className="capsule-row-text">{c.label ?? c.id.slice(0, 8)}</span>
                      <span className="capsule-row-meta">{modeLabel}{childRunning ? ` · ${t("运行中")}` : ""}</span>
                    </button>
                    {childRunning && c.mode === "continuable" && (
                      <button type="button" className="capsule-stop" title={t("中断子代理")} disabled={busy} onClick={() => void interrupt(c.id)}>
                        <Square size={11} />
                      </button>
                    )}
                  </div>
                );
              })}
              {diag && <div className="capsule-note">{t("部分子会话状态不可读")}</div>}
            </div>
          )}
          {git && git.files > 0 && <CapsuleGitSection wsPath={wsPath} git={git} onRefresh={loadGit} />}
          {(scheduleRecords.length > 0 || jobs.length > 0) && (
            <div className="capsule-sec">
              <div className="capsule-sec-name"><AlarmClock size={12} />{t("提醒与自动化")}</div>
              {scheduleRecords.map((r) => (
                <div key={r.id} className="capsule-row">
                  <span className="state-dot running" aria-hidden="true" />
                  <span className="capsule-row-text">{r.prompt}</span>
                  <span className="capsule-row-meta">{fmtScheduleWhen(r)}</span>
                </div>
              ))}
              {jobs.map((j) => (
                <div key={j.id} className="capsule-row">
                  <span className={`state-dot ${j.status === "failed" ? "error" : j.status === "running" ? "running" : "ok"}`} aria-hidden="true" />
                  <span className="capsule-row-text">{j.label}</span>
                  <span className="capsule-row-meta">
                    {j.kind} · {tt(...(JOB_STATUS[j.status] ?? JOB_STATUS.running!))}
                    {j.detail ? ` · ${j.detail}` : ""}
                  </span>
                  <span className="capsule-row-meta">{elapsed(j.startedAt, j.finishedAt, now)}</span>
                </div>
              ))}
            </div>
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
      <strong>{t("这是子代理会话")}</strong>
      <span>{t("目录寻址的子会话在此只读；继续对话请回到父会话。")}</span>
      {parentSessionId && (
        <button type="button" className="subagent-parent-link" onClick={() => openSession(parentSessionId)}>
          {parentTitle}
        </button>
      )}
    </div>
  );
}
