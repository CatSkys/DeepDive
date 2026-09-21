import type { GitStatus, ScheduleRecord } from "../types";

// 状态聚合胶囊的数据模型（纯函数，无 React）。收起态不是轮播：按当前运行
// 状态固定显示一类，优先级 = 运行中的智能体 > 进行中任务 > 未提交改动 >
// 最近提醒，全空则胶囊隐藏。引擎契约：todos 投影 = {content,status}[] |
// null（todo/write 整表替换，DSH-WIRE §3.3）；git 数据来自壳层 run-git
// 桥消息（引擎无 git 能力），非 git 仓库收窄为 null。

export interface CapsuleTodo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

const GOAL_PHASE: Record<string, [string, string]> = {
  active: ["进行中", "Active"],
  paused: ["已暂停", "Paused"],
  blocked: ["受阻", "Blocked"],
  complete: ["已完成", "Complete"],
};

/** 目标阶段文案对（[zh, en]），消费方 tt(...pair)：StatusCapsule 摘要与
 *  GoalBar 共用这一份；未知阶段按"进行中"显示。 */
export function goalPhasePair(phase: string): [string, string] {
  return GOAL_PHASE[phase] ?? GOAL_PHASE.active;
}

export function todoStats(todos: CapsuleTodo[] | null | undefined): {
  done: number;
  total: number;
  active: CapsuleTodo | undefined;
} {
  const list = todos ?? [];
  return {
    done: list.filter((t) => t.status === "completed").length,
    total: list.length,
    active: list.find((t) => t.status === "in_progress"),
  };
}

/** 短表阈值：整表不超过它就全列（含已完成），超过才走聚焦窗。 */
export const TODO_COMPACT_THRESHOLD = 6;
/** 聚焦窗留下的未完成项条数（长表才生效）。 */
export const TODO_PENDING_WINDOW = 3;

export interface CapsuleTodoView {
  done: number;
  total: number;
  active: CapsuleTodo | undefined;
  /** 未完成项（进行中已单列，故这里只含 pending）；长表已被窗口裁剪。 */
  pending: CapsuleTodo[];
  /** 被窗口折掉的未完成项（短表为空）——调用方给"展开其余 N 项"的计数与落点。 */
  pendingHidden: CapsuleTodo[];
  /** 已完成项。 */
  completed: CapsuleTodo[];
  /** 短表：已完成直接内联展示，不折叠——清单短时"做过什么"本身就是可读信息，
   *  收起来反而要多点一次（对照 ZCode 只对长清单做折叠的做法）。 */
  listCompleted: boolean;
}

/** 任务清单的展示视图（纯函数）：短表全列；长表只留进行中 + 前 N 项未完成，
 *  其余折成计数行，避免面板被一条长清单灌满。 */
export function todoView(todos: CapsuleTodo[] | null | undefined): CapsuleTodoView {
  const list = todos ?? [];
  const pending = list.filter((t) => t.status === "pending");
  const completed = list.filter((t) => t.status === "completed");
  const compact = list.length <= TODO_COMPACT_THRESHOLD;
  return {
    done: completed.length,
    total: list.length,
    active: list.find((t) => t.status === "in_progress"),
    pending: compact ? pending : pending.slice(0, TODO_PENDING_WINDOW),
    pendingHidden: compact ? [] : pending.slice(TODO_PENDING_WINDOW),
    completed,
    listCompleted: compact,
  };
}

/** 最近提醒：取折叠序首条（schedule/change 折叠序即会话内最新目录）。 */
export function nextScheduleRecord(records: ScheduleRecord[]): ScheduleRecord | null {
  return records[0] ?? null;
}

export type CapsuleCategory =
  | { kind: "agents"; count: number }
  | { kind: "todo"; active: string; done: number; total: number }
  | { kind: "git"; additions: number; deletions: number }
  | { kind: "schedule"; prompt: string; when: string };

/** 收起态显示哪一类：第一个非空的优先级；全空 → null（胶囊隐藏）。 */
export function capsuleCategory(input: {
  agentsRunning: number;
  todos: CapsuleTodo[] | null | undefined;
  git: GitStatus | null;
  scheduleRecords: ScheduleRecord[];
  fmtScheduleWhen: (r: ScheduleRecord) => string;
}): CapsuleCategory | null {
  if (input.agentsRunning > 0) return { kind: "agents", count: input.agentsRunning };
  const s = todoStats(input.todos);
  if (s.active) return { kind: "todo", active: s.active.content, done: s.done, total: s.total };
  if (input.git && input.git.files > 0) {
    return { kind: "git", additions: input.git.additions, deletions: input.git.deletions };
  }
  const next = nextScheduleRecord(input.scheduleRecords);
  if (next) return { kind: "schedule", prompt: next.prompt, when: input.fmtScheduleWhen(next) };
  return null;
}
