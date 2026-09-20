// 自动化任务的领域模型：任务/计划/运行记录的类型，以及「计划怎么算、怎么说」
// 的纯函数。不含持久化（storage.ts）、引擎调用（runner.ts）与 React 状态
//（useAutomation.tsx）——那三件各有自己的文件。

import { t, tt, type Lang } from "../i18n";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** 计划：与编辑器里那排下拉一一对应（每小时 / 每天 / 每工作日 / 每周 / 每月 / 自定义）。 */
export type Schedule =
  | { kind: "hourly"; minute: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekdays"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number }
  | { kind: "monthly"; day: number; hour: number; minute: number }
  /** 自定义：每 everyDays 天，于 hour:minute。 */
  | { kind: "custom"; everyDays: number; hour: number; minute: number };

export type ScheduleKind = Schedule["kind"];

export const SCHEDULE_KINDS: readonly ScheduleKind[] = ["hourly", "daily", "weekdays", "weekly", "monthly", "custom"];

/** 任务状态：启用中的任务到点会跑，暂停的只能手动「立即运行」。 */
export type TaskStatus = "enabled" | "paused";

/** 运行目标：new = 每次都新开一个会话；session = 复用同一个会话（首次运行自动创建）。 */
export type RunTarget = "new" | "session";

export interface TaskModel {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

export interface AutomationTask {
  id: string;
  title: string;
  /** 到点发给新会话的指令原文。 */
  instruction: string;
  schedule: Schedule;
  /** 目标工作空间；null = 交给引擎默认（当前活动空间）。 */
  workspaceId: string | null;
  /** 引擎权限预设键（如 workspace-write）；null = 跟随会话默认。 */
  permission: string | null;
  /** 运行用的模型；null = 跟随引擎默认。 */
  model: TaskModel | null;
  target: RunTarget;
  /** target=session 时复用的会话（首次运行后落定）；被删了下次运行就重建一个。 */
  sessionId: string | null;
  status: TaskStatus;
  /** 下次触发时刻（毫秒）；null = 未排期（未启用过或计划刚被清空）。 */
  nextRunAt: number | null;
  lastRunAt: number | null;
  runCount: number;
  createdAt: number;
}

/** 一次运行记录。「running」在轮询里对账：会话不再运行即落 done/error。 */
export interface TaskRun {
  id: string;
  taskId: string;
  /** 建会话那一刻就补上（不是跑完才补）——应用中途退出时，这条记录仍能对账。 */
  sessionId: string | null;
  /** 实际开始时刻（醒来补跑时就是补跑时刻）。 */
  startedAt: number;
  /** 本次比计划晚多久（ms，0 = 准点）；运行历史里显示，别让"迟到"隐形。 */
  lateMs?: number;
  status: "running" | "done" | "error";
  error?: string;
}

/** 新建任务的草稿：除 id/计数/排期外的全部字段。 */
export type TaskDraft = Omit<AutomationTask, "id" | "nextRunAt" | "lastRunAt" | "runCount" | "createdAt">;

/** 复用目标：只有 target=session 且记住的会话仍在引擎列表里才复用它。 */
export function reuseSessionId(task: AutomationTask, known: ReadonlySet<string>): string | null {
  if (task.target !== "session" || task.sessionId === null) return null;
  return known.has(task.sessionId) ? task.sessionId : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** HH:MM（计划参数与展示共用）。 */
export function clockText(hour: number, minute: number): string {
  return `${pad(hour)}:${pad(minute)}`;
}

/** 每类计划的默认参数：「+ 添加计划」的落点，也是切换类型时的取值。 */
export function defaultSchedule(kind: ScheduleKind): Schedule {
  switch (kind) {
    case "hourly": return { kind, minute: 0 };
    case "daily": return { kind, hour: 9, minute: 0 };
    case "weekdays": return { kind, hour: 9, minute: 0 };
    case "weekly": return { kind, weekday: 1, hour: 9, minute: 0 };
    case "monthly": return { kind, day: 1, hour: 9, minute: 0 };
    case "custom": return { kind, everyDays: 1, hour: 9, minute: 0 };
  }
}

/** 以 base 的日历日为锚偏移 offsetDays 天后的 hour:minute；按日历推进而非加
 *  毫秒，跨夏令时时本地钟点不漂。 */
function dayAt(base: Date, offsetDays: number, hour: number, minute: number): number {
  const d = new Date(base);
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

/** 严格晚于 from 的下一次触发时刻（本地时区）。 */
export function nextRunAt(s: Schedule, from: number): number {
  const base = new Date(from);
  switch (s.kind) {
    case "hourly": {
      const d = new Date(base);
      d.setMinutes(s.minute, 0, 0);
      return d.getTime() > from ? d.getTime() : d.getTime() + HOUR;
    }
    case "daily": {
      const today = dayAt(base, 0, s.hour, s.minute);
      return today > from ? today : dayAt(base, 1, s.hour, s.minute);
    }
    case "weekdays": {
      let at = dayAt(base, 0, s.hour, s.minute);
      let n = 0;
      while (at <= from || !isWeekday(at)) {
        n += 1;
        at = dayAt(base, n, s.hour, s.minute);
      }
      return at;
    }
    case "weekly": {
      let at = dayAt(base, 0, s.hour, s.minute);
      let n = 0;
      while (at <= from || new Date(at).getDay() !== s.weekday) {
        n += 1;
        at = dayAt(base, n, s.hour, s.minute);
      }
      return at;
    }
    case "monthly": {
      let at = monthDayAt(base, 0, s);
      let k = 0;
      while (at <= from) {
        k += 1;
        at = monthDayAt(base, k, s);
      }
      return at;
    }
    case "custom": {
      let at = dayAt(base, 0, s.hour, s.minute);
      let n = 0;
      while (at <= from) {
        n += s.everyDays;
        at = dayAt(base, n, s.hour, s.minute);
      }
      return at;
    }
  }
}

function isWeekday(at: number): boolean {
  const wd = new Date(at).getDay();
  return wd >= 1 && wd <= 5;
}

/** 自 base 起第 k 个月的 day 日 hour:minute；该月没有这一天时取月末。 */
function monthDayAt(base: Date, k: number, s: { day: number; hour: number; minute: number }): number {
  const d = new Date(base.getFullYear(), base.getMonth() + k, 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(s.day, lastDay));
  d.setHours(s.hour, s.minute, 0, 0);
  return d.getTime();
}

const WEEKDAY_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function weekdayLabel(weekday: number): string {
  return tt(WEEKDAY_ZH[weekday] ?? "", WEEKDAY_EN[weekday] ?? "");
}

/** 计划文案：prefix 常显，time 是需要高亮的时间部分（无则空串）。 */
export function describeSchedule(s: Schedule): { prefix: string; time: string } {
  switch (s.kind) {
    case "hourly": return { prefix: t("每小时"), time: `:${pad(s.minute)}` };
    case "daily": return { prefix: t("每天"), time: clockText(s.hour, s.minute) };
    case "weekdays": return { prefix: t("每工作日"), time: clockText(s.hour, s.minute) };
    case "weekly": return { prefix: tt(`每{wd}`, `Every {wd}`, { wd: weekdayLabel(s.weekday) }), time: clockText(s.hour, s.minute) };
    case "monthly": return { prefix: tt(`每月 {n} 日`, `Day {n} monthly`, { n: String(s.day) }), time: clockText(s.hour, s.minute) };
    case "custom": return { prefix: tt(`每 {n} 天`, `Every {n} days`, { n: String(s.everyDays) }), time: clockText(s.hour, s.minute) };
  }
}

/** 时区标签（如 GMT+8）：计划按本机时区生效，编辑器只展示，不可改。 */
export function utcOffsetLabel(now: Date = new Date()): string {
  const mins = -now.getTimezoneOffset();
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  return `GMT${mins < 0 ? "-" : "+"}${h}${m === 0 ? "" : `:${pad(m)}`}`;
}

/** 运行历史的时间戳（本地时区，月-日 时:分）。 */
export function runTimeText(ts: number, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(ts));
}

/** 迟到文案：本次比计划晚了多久（准点或差不到 1 分钟 = 空串，不占地方）。 */
export function lateText(lateMs: number | undefined, lang: Lang): string {
  if (lateMs === undefined || lateMs < 60_000) return "";
  const m = Math.round(lateMs / 60_000);
  const label = m < 60 ? (lang === "zh" ? `${m} 分` : `${m}m`) : (lang === "zh" ? `${Math.round(m / 60)} 小时` : `${Math.round(m / 60)}h`);
  return lang === "zh" ? `迟 ${label}` : `${label} late`;
}

/** 形状校验（localStorage 是外部输入边界）：参数齐全且都是有限数的才算数。 */
export function isSchedule(v: unknown): v is Schedule {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  const n = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  switch (s.kind) {
    case "hourly": return n(s.minute);
    case "daily":
    case "weekdays": return n(s.hour) && n(s.minute);
    case "weekly": return n(s.weekday) && n(s.hour) && n(s.minute);
    case "monthly": return n(s.day) && n(s.hour) && n(s.minute);
    case "custom": return n(s.everyDays) && n(s.hour) && n(s.minute);
    default: return false;
  }
}
