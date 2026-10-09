// 会话状态数据的取数（从 StatusCapsule 抽出的同一份逻辑，面板与入口共用一份）。
// 只管取数与派生，不管渲染——派生与优先级仍在 components/capsuleModel（纯函数、可测）。
// Git 数据来自壳层 run-git 桥消息（引擎无 git 能力）。

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { gitStatus } from "../host";
import { tt } from "../i18n";
import { useStore } from "../store";
import {
  capsulePill, classifyJobs, statusPanelHasContent, todoView,
  type CapsulePill, type CapsuleTodo,
} from "../components/capsuleModel";
import type { GitStatus, GoalProjection, JobView, ScheduleRecord, SubagentListEntry } from "../types";

type ChildEntry = Extract<SubagentListEntry, { kind: "child" }>;

export interface CapsuleData {
  todos: CapsuleTodo[] | null | undefined;
  goal: GoalProjection["goal"] | undefined;
  git: GitStatus | null;
  wsPath: string | undefined;
  jobs: JobView[];
  jobSplit: ReturnType<typeof classifyJobs>;
  children: ChildEntry[];
  diag: boolean;
  runningChildren: number;
  runningChildIds: Set<string>;
  runningCount: number;
  endedCount: number;
  hasContent: boolean;
  pill: CapsulePill | null;
  todo: ReturnType<typeof todoView>;
  /** 面板展开且有活跃任务时的秒级时钟（运行时长用）。 */
  now: number;
  reloadChildren: () => void;
  reloadGit: () => void;
  interrupt: (childId: string) => Promise<void>;
  busy: boolean;
}

export function useCapsuleData(sessionId: string, scheduleRecords: ScheduleRecord[], live: boolean,
                               /** agent 与浏览器的关系（本会话）+ 当前页标题：胶囊的浏览器入口用。 */
                               browser: { used: boolean; live: boolean; title: string } = { used: false, live: false, title: "" }): CapsuleData {
  const { sessions, jobsBySession, wsOfSession, workspaces, activeWorkspaceId, subscribeControl } = useStore();
  // control 流实时帧优先（undefined=尚无帧，用 store 投影基线），照 SessionView goal 模式
  const [liveTodos, setLiveTodos] = useState<CapsuleTodo[] | null | undefined>(undefined);
  const [children, setChildren] = useState<ChildEntry[]>([]);
  const [diag, setDiag] = useState(false);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const session = sessions.find((s) => s.sessionId === sessionId);
  const running = session?.running ?? false;
  const jobs = jobsBySession.get(sessionId) ?? [];
  const jobSplit = classifyJobs(jobs);
  const storeTodos = session?.projections?.values?.todos as CapsuleTodo[] | null | undefined;
  const todos = liveTodos ?? storeTodos;
  const goal = (session?.projections?.values?.goal as GoalProjection | null | undefined)?.goal;

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
    if (!live && !running) return;
    const iv = setInterval(loadChildren, 10000);
    return () => clearInterval(iv);
  }, [live, running, loadChildren]);

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
    if (!live || jobSplit.live.length === 0) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [live, jobSplit.live.length]);

  const childRunning = (c: ChildEntry) => !!sessions.find((s) => s.sessionId === c.id)?.running || c.activity === "running";
  const runningChildren = children.filter(childRunning).length;
  const runningChildIds = new Set(children.filter(childRunning).map((c) => c.id));
  const interrupt = useCallback(async (childId: string) => {
    setBusy(true);
    try {
      await api.subagentInterrupt({ parentSessionId: sessionId, childSessionId: childId });
      loadChildren();
    } catch { /* 引擎忙或不可中断：行上状态点反映实况 */ }
    setBusy(false);
  }, [sessionId, loadChildren]);

  const todo = todoView(todos);
  const runningCount = runningChildren + jobSplit.live.length;
  const endedCount = jobSplit.ended.length + (children.length - runningChildren);
  const hasContent = statusPanelHasContent({
    todos, goal, git, scheduleRecords,
    jobCount: jobs.length,
    subagentEntryCount: children.length,
    runningCount,
  });
  const pill = capsulePill({ todos, goal, git, runningCount, endedCount, scheduleRecords, fmtScheduleWhen, browser });

  return {
    todos, goal, git, wsPath, jobs, jobSplit, children, diag,
    runningChildren, runningChildIds, runningCount, endedCount, hasContent, pill, todo, now,
    reloadChildren: loadChildren, reloadGit: loadGit, interrupt, busy,
  };
}

/** 提醒时间的显示（"每 N 分钟"/"N 分钟后"/本地时刻）。 */
export function fmtScheduleWhen(r: ScheduleRecord): string {
  if (r.kind === "every") return tt("每 {n} 分钟", "every {n} min", { n: Math.round((r.everySeconds ?? 300) / 60) });
  if (typeof r.afterSeconds === "number") return tt("{n} 分钟后", "in {n} min", { n: Math.max(1, Math.round(r.afterSeconds / 60)) });
  if (r.scheduledAt) {
    return new Date(r.scheduledAt).toLocaleString(undefined, { month: "numeric", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  return "—";
}
