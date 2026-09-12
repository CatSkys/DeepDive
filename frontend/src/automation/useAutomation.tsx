// 自动化状态（App 级单例）：任务清单、运行历史、调度 tick 与「保持唤醒」信号。
// 挂在 App 顶层而不是页面里——到点触发不依赖用户正开着自动化页面，页面只是
// 它的一个视图。调度是客户端行为：引擎在本引脚没有定时任务面（SPEC-AUTOMATION §1），
// 代价是应用没运行时不会触发（到点补差见 CATCHUP_MS）。

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "../store";
import { setKeepAwake } from "../host";
import { tt } from "../i18n";
import { nextRunAt, type AutomationTask, type TaskDraft, type TaskRun } from "./model";
import { startRun } from "./runner";
import { loadKeepAwake, loadRuns, loadTasks, saveKeepAwake, saveRuns, saveTasks, trimRuns } from "./storage";

/** 调度 tick 间隔（任务按分钟排班，秒级精度没有意义）。 */
const TICK_MS = 30_000;
/** 启动补差窗口：错过不超过这段时间的任务照跑，更早的直接顺延——不让开机
 *  时一连串补跑刷屏。 */
const CATCHUP_MS = 5 * 60_000;
/** 运行对账宽限：刚发起的会话在引擎侧还没标 running，等一会儿再判完成。 */
const RECONCILE_GRACE_MS = 10_000;

interface AutomationApi {
  tasks: AutomationTask[];
  /** 全部运行记录（已按任务裁剪，新→旧）。 */
  runs: TaskRun[];
  /** 正在执行的任务 id：卡片与菜单据此显示运行中 / 禁用重复触发。 */
  running: ReadonlySet<string>;
  keepAwake: boolean;
  setKeepAwake: (on: boolean) => void;
  createTask: (draft: TaskDraft) => AutomationTask;
  /** 改任务；计划变了或从暂停恢复时自动重排下一班。 */
  updateTask: (id: string, patch: Partial<AutomationTask>) => void;
  deleteTask: (id: string) => void;
  /** 立即运行一次（暂停中的任务也能跑）；回传这次会话的 id，失败回 null。 */
  runNow: (id: string, patch?: Partial<AutomationTask>) => Promise<string | null>;
}

const Ctx = createContext<AutomationApi | null>(null);

export function useAutomation(): AutomationApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useAutomation outside AutomationProvider");
  return api;
}

export function AutomationProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const [tasks, setTasks] = useState<AutomationTask[]>(loadTasks);
  const [runs, setRuns] = useState<TaskRun[]>(loadRuns);
  const [running, setRunning] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [keepAwakeOn, setKeepAwakeOn] = useState(loadKeepAwake);

  // tick 活在 interval 里，读最新值一律经 ref（否则闭包锁死首次渲染的清单）。
  const storeRef = useRef(store);
  storeRef.current = store;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  // 同步在飞的判据用 ref 而非 state：两次 tick 撞在同一帧时 state 还没渲染，
  // 只有 ref 能在 await 之前挡住重复触发。
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => { saveTasks(tasks); }, [tasks]);
  useEffect(() => { saveRuns(runs); }, [runs]);
  useEffect(() => { saveKeepAwake(keepAwakeOn); }, [keepAwakeOn]);

  const addRun = useCallback((run: TaskRun) => {
    setRuns((prev) => trimRuns([run, ...prev]));
  }, []);

  /** 跑一次：先排下一班、记一条运行记录，再执行——执行失败也要留痕。 */
  const fire = useCallback(async (task: AutomationTask, now: number): Promise<string | null> => {
    if (inFlightRef.current.has(task.id)) return null;
    inFlightRef.current.add(task.id);
    setRunning(new Set(inFlightRef.current));
    const run: TaskRun = { id: crypto.randomUUID(), taskId: task.id, sessionId: null, startedAt: now, status: "running" };
    addRun(run);
    setTasks((prev) => prev.map((t) => (t.id === task.id
      ? { ...t, nextRunAt: nextRunAt(t.schedule, now), lastRunAt: now, runCount: t.runCount + 1 }
      : t)));
    const outcome = await startRun(task);
    setRuns((prev) => prev.map((r) => {
      if (r.id !== run.id) return r;
      return "error" in outcome
        ? { ...r, status: "error", error: outcome.error }
        : { ...r, sessionId: outcome.sessionId };
    }));
    inFlightRef.current.delete(task.id);
    setRunning(new Set(inFlightRef.current));
    void storeRef.current.refresh();
    return "error" in outcome ? null : outcome.sessionId;
  }, [addRun]);

  /** 对账：引擎没有"会话结束"事件，用轮询到的 running 判定运行记录的收尾。 */
  const reconcile = useCallback((now: number) => {
    if (!storeRef.current.engineUp) return; // 读不到会话列表时不改写状态
    const all = storeRef.current.allSessions;
    setRuns((prev) => {
      let changed = false;
      const next = prev.map((r): TaskRun => {
        if (r.status !== "running" || r.sessionId === null || now - r.startedAt < RECONCILE_GRACE_MS) return r;
        const s = all.find((x) => x.sessionId === r.sessionId);
        if (s !== undefined && s.running) return r;
        changed = true;
        return s === undefined
          ? { ...r, status: "error", error: tt("会话已不存在", "Session no longer exists") }
          : { ...r, status: "done" };
      });
      return changed ? next : prev;
    });
  }, []);

  const tick = useCallback(async () => {
    const now = Date.now();
    reconcile(now);
    for (const task of tasksRef.current) {
      if (task.status !== "enabled" || task.nextRunAt === null) continue;
      if (task.nextRunAt > now || inFlightRef.current.has(task.id)) continue;
      await fire(task, now);
    }
  }, [fire, reconcile]);

  // 启动：排期补差 + 首轮 tick；此后按 TICK_MS 走。
  useEffect(() => {
    const now = Date.now();
    setTasks((prev) => prev.map((t) => {
      if (t.status !== "enabled") return t;
      if (t.nextRunAt === null || now - t.nextRunAt > CATCHUP_MS) return { ...t, nextRunAt: nextRunAt(t.schedule, now) };
      return t;
    }));
    void tick();
    const iv = window.setInterval(() => { void tick(); }, TICK_MS);
    return () => window.clearInterval(iv);
  }, [tick]);

  // 保持唤醒：开关开着且有会话在跑时按住空闲休眠断言，停跑即释放。
  const hold = keepAwakeOn && store.sessions.some((s) => s.running);
  useEffect(() => { setKeepAwake(hold); }, [hold]);
  useEffect(() => () => setKeepAwake(false), []);

  const value = useMemo<AutomationApi>(() => ({
    tasks, runs, running, keepAwake: keepAwakeOn,
    setKeepAwake: setKeepAwakeOn,
    createTask: (draft) => {
      const now = Date.now();
      const task: AutomationTask = {
        ...draft,
        id: crypto.randomUUID(),
        nextRunAt: draft.status === "enabled" ? nextRunAt(draft.schedule, now) : null,
        lastRunAt: null,
        runCount: 0,
        createdAt: now,
      };
      setTasks((prev) => [task, ...prev]);
      return task;
    },
    updateTask: (id, patch) => {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t, ...patch };
        if (next.status === "paused") return { ...next, nextRunAt: null };
        // 计划变了、或从暂停恢复：下一班从此刻重排（改计划不该沿用旧时刻）
        const rescheduled = patch.schedule !== undefined || t.status !== "enabled";
        return rescheduled ? { ...next, nextRunAt: nextRunAt(next.schedule, Date.now()) } : next;
      }));
    },
    deleteTask: (id) => {
      setTasks((prev) => prev.filter((t) => t.id !== id));
      setRuns((prev) => prev.filter((r) => r.taskId !== id));
    },
    runNow: async (id, patch) => {
      const task = tasksRef.current.find((t) => t.id === id);
      if (task === undefined) return null;
      return fire(patch === undefined ? task : { ...task, ...patch }, Date.now());
    },
  }), [tasks, runs, running, keepAwakeOn, fire]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
