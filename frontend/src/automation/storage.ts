// 自动化任务的本地持久化：任务清单、运行历史、保持唤醒开关。
// 「本地」是设计而非权宜——引擎在本引脚没有定时任务面（SPEC-AUTOMATION §1），
// 任务属于这台机器的这个用户。读取是外部输入边界：形状不合的条目丢弃，
// 可选字段缺失按 null/0 归一，不做逐字段猜谜。

import { isSchedule, type AutomationTask, type TaskModel, type TaskRun } from "./model";

const KEY_TASKS = "deepdive.automation.tasks";
const KEY_RUNS = "deepdive.automation.runs";
const KEY_KEEP_AWAKE = "deepdive.automation.keepAwake";

/** 每个任务保留的运行记录条数：历史页只看近况，不做长期归档。 */
export const RUNS_PER_TASK = 50;

function readJSON(key: string): unknown {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null; // 损坏的旧缓存：当没写过，下一次 save 覆盖
  }
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseModel(v: unknown): TaskModel | null {
  if (typeof v !== "object" || v === null) return null;
  const m = v as Record<string, unknown>;
  const provider = str(m.provider);
  const model = str(m.model);
  if (provider === null || model === null) return null;
  const effort = str(m.reasoningEffort);
  return { provider, model, ...(effort === null ? {} : { reasoningEffort: effort }) };
}

function parseTask(v: unknown): AutomationTask | null {
  if (typeof v !== "object" || v === null) return null;
  const t = v as Record<string, unknown>;
  const id = str(t.id);
  const title = str(t.title);
  const instruction = str(t.instruction);
  if (id === null || title === null || instruction === null) return null;
  if (!isSchedule(t.schedule)) return null;
  if (t.status !== "enabled" && t.status !== "paused") return null;
  return {
    id, title, instruction, schedule: t.schedule,
    workspaceId: str(t.workspaceId),
    permission: str(t.permission),
    model: parseModel(t.model),
    // 老记录没有这两个字段：默认「每次新建会话」、无绑定会话
    target: t.target === "session" ? "session" : "new",
    sessionId: str(t.sessionId),
    status: t.status,
    nextRunAt: num(t.nextRunAt),
    lastRunAt: num(t.lastRunAt),
    runCount: num(t.runCount) ?? 0,
    createdAt: num(t.createdAt) ?? Date.now(),
  };
}

function parseRun(v: unknown): TaskRun | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  const id = str(r.id);
  const taskId = str(r.taskId);
  const startedAt = num(r.startedAt);
  if (id === null || taskId === null || startedAt === null) return null;
  if (r.status !== "running" && r.status !== "done" && r.status !== "error") return null;
  const error = str(r.error);
  return { id, taskId, sessionId: str(r.sessionId), startedAt, status: r.status, ...(error === null ? {} : { error }) };
}

export function loadTasks(): AutomationTask[] {
  const raw = readJSON(KEY_TASKS);
  if (!Array.isArray(raw)) return [];
  return raw.map(parseTask).filter((t): t is AutomationTask => t !== null);
}

export function saveTasks(tasks: AutomationTask[]): void {
  localStorage.setItem(KEY_TASKS, JSON.stringify(tasks));
}

export function loadRuns(): TaskRun[] {
  const raw = readJSON(KEY_RUNS);
  if (!Array.isArray(raw)) return [];
  return raw.map(parseRun).filter((r): r is TaskRun => r !== null);
}

export function saveRuns(runs: TaskRun[]): void {
  localStorage.setItem(KEY_RUNS, JSON.stringify(runs));
}

/** 按任务裁剪到 RUNS_PER_TASK 条（新→旧）；插入记录时调用，保证落盘与内存一致。 */
export function trimRuns(runs: TaskRun[]): TaskRun[] {
  const kept: TaskRun[] = [];
  const count = new Map<string, number>();
  for (const r of [...runs].sort((a, b) => b.startedAt - a.startedAt)) {
    const n = count.get(r.taskId) ?? 0;
    if (n >= RUNS_PER_TASK) continue;
    count.set(r.taskId, n + 1);
    kept.push(r);
  }
  return kept;
}

export function loadKeepAwake(): boolean {
  return localStorage.getItem(KEY_KEEP_AWAKE) === "1";
}

export function saveKeepAwake(on: boolean): void {
  localStorage.setItem(KEY_KEEP_AWAKE, on ? "1" : "0");
}
