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
