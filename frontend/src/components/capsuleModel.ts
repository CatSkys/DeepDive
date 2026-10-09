import type { GitStatus, GoalProjection, JobView, ScheduleRecord } from "../types";

// 状态面板的数据模型（纯函数，无 React）。形状照 ZCode 的
// conversationStatusPanelModel：派生与优先级都收在这里，组件只把模型画出来，
// 所以状态转换可测（此前这些派生散在组件里，只有纯函数那几段有护栏）。
//
// 收起态 pill 是一条**优先级回落链**（对应 ZCode ConversationStatusPanel 的
// StatusSummaryRow）：从上往下第一个非空者获胜。顺序与它一致——
//   agent 正在操控浏览器 → 当前任务 → agent 用过浏览器 → 活动中的目标 → 未提交改动
//   → 已完成的目标 → 最后一条已完成任务 → 运行中计数 → 最近提醒 → 已结束计数
// 三条排序理由也照抄：当前任务先于一切；"活动中的目标"与"已完成的目标"分列两级
// （同一个标题会换级）；**live 活动只作兜底**（composer 自己已有活动入口，pill 不跟
// 它重复），所以运行计数排在任务/目标/改动之后；最后的已结束计数与 ZCode 的
// "已结束工作流"同级同位——它存在的意义是别让面板塌成空壳。
// ZCode 链里还有一级"最近的会话计划"（ExitPlanMode 历史行），本仓引擎没有那类历史，
// 故这一级缺省（不是遗漏，是数据面没有）。
//
// 浏览器那两级是本仓加的（用户 2026-10-09：agent 操控浏览器时界面上没有任何显示，
// 人也不知道去哪儿看）：**正在操控时压过一切**（那是此刻正在发生的事，带活信号），
// 用过之后常驻在当前任务之下——浏览器全应用只此一条入口，压太低等于没有。

/** 目标状态：复用 types.ts 里 GoalProjection 的内层形状，不另立一份。 */
export type CapsuleGoal = GoalProjection["goal"];

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

/** 目标阶段文案对（[zh, en]），消费方 tt(...pair)：状态面板的目标区（CapsuleGoalSection）；
 *  未知阶段按"进行中"显示。 */
export function goalPhasePair(phase: string): [string, string] {
  return GOAL_PHASE[phase] ?? GOAL_PHASE.active;
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

/** 活动域：后台任务按"还在跑 / 已结束"分两拨（ZCode 对 terminals 只看 running，
 *  已结束的另给落点，不混在同一列表里）。 */
export interface CapsuleJobs {
  live: JobView[];
  ended: JobView[];
}

export function classifyJobs(jobs: readonly JobView[]): CapsuleJobs {
  const live: JobView[] = [];
  const ended: JobView[] = [];
  for (const j of jobs) (j.status === "running" || j.status === "stopping" ? live : ended).push(j);
  return { live, ended };
}

export type CapsulePill =
  | { kind: "todo"; text: string; done: number; total: number }
  | { kind: "goal"; title: string; done: boolean }
  | { kind: "git"; additions: number; deletions: number }
  | { kind: "todoDone"; text: string }
  | { kind: "running"; count: number }
  | { kind: "schedule"; prompt: string; when: string }
  | { kind: "ended"; count: number }
  | { kind: "browser"; title: string; live: boolean };

/** 收起态显示什么：优先级回落链，第一个非空者获胜；全空 → null（胶囊隐藏）。 */
export function capsulePill(input: {
  todos: CapsuleTodo[] | null | undefined;
  goal: CapsuleGoal | null | undefined;
  git: GitStatus | null;
  runningCount: number;
  endedCount: number;
  scheduleRecords: ScheduleRecord[];
  fmtScheduleWhen: (r: ScheduleRecord) => string;
  /** agent 与浏览器的关系（本会话）：`live` = 此刻正在操控（工具调用在飞），
   *  `used` = 操控过（含已结束），`title` = 当前页标题（拿不到给空串）。 */
  browser?: { live: boolean; used: boolean; title: string };
}): CapsulePill | null {
  const list = input.todos ?? [];
  const completed = list.filter((t) => t.status === "completed");
  const browser = input.browser;
  // ⓪ agent 正在操控浏览器：此刻正在发生的事压过一切（含当前任务）——用户报"agent
  //    操控浏览器时界面上没有任何显示"就是这一格缺位（见文件头）。
  if (browser?.live) return { kind: "browser", title: browser.title, live: true };
  // ① 当前任务：进行中优先，其次第一条待办（ZCode: inProgress ?? 第一条 pending）。
  //    只看 in_progress 的话，模型刚写完计划、还没开工时 pill 会整个空掉。
  const current = list.find((t) => t.status === "in_progress") ?? list.find((t) => t.status === "pending");
  if (current) return { kind: "todo", text: current.content, done: completed.length, total: list.length };
  // ①′ agent 操控过浏览器（本会话）：入口常驻——它不盖过"当前任务"，但也不能被
  //    目标/改动挤掉（浏览器只此一条入口）。
  if (browser?.used) return { kind: "browser", title: browser.title, live: false };
  // ② 活动中的目标（本仓阶段：active / paused / blocked 都算"还没完"）
  const title = input.goal?.objective;
  const phase = input.goal?.phase;
  if (title && phase && phase !== "complete") return { kind: "goal", title, done: false };
  // ③ 未提交改动
  if (input.git && input.git.files > 0) {
    return { kind: "git", additions: input.git.additions, deletions: input.git.deletions };
  }
  // ④ 已完成的目标（与 ② 同一个标题分列两级，ZCode 同款写法）
  if (title && phase === "complete") return { kind: "goal", title, done: true };
  // ⑤ 最后一条已完成的任务
  const lastDone = completed[completed.length - 1];
  if (lastDone) return { kind: "todoDone", text: lastDone.content };
  // ⑥ 运行中计数（live 活动只作兜底，见文件头）
  if (input.runningCount > 0) return { kind: "running", count: input.runningCount };
  // ⑦ 最近提醒：兜底一级，避免面板塌成空壳
  const next = nextScheduleRecord(input.scheduleRecords);
  if (next) return { kind: "schedule", prompt: next.prompt, when: input.fmtScheduleWhen(next) };
  // ⑧ 已结束计数：兜底链的最底层（ZCode 的"已结束工作流"同位）
  if (input.endedCount > 0) return { kind: "ended", count: input.endedCount };
  return null;
}

/** 面板是否有内容可画——它决定面板存亡，所以取"每个会渲染的区是否有料"的或：
 *  任务表 / 目标 / 改动 / 提醒 / 后台任务（含已结束，本仓这一区会列出它们）/
 *  子智能体目录 / 运行中的子会话。ZCode 同款判据（只是他们的区集合不同）。 */
export function statusPanelHasContent(input: {
  todos: CapsuleTodo[] | null | undefined;
  goal: CapsuleGoal | null | undefined;
  git: GitStatus | null;
  scheduleRecords: ScheduleRecord[];
  jobCount: number;
  subagentEntryCount: number;
  runningCount: number;
}): boolean {
  const list = input.todos ?? [];
  return list.length > 0
    || Boolean(input.goal)
    || Boolean(input.git && input.git.files > 0)
    || input.scheduleRecords.length > 0
    || input.jobCount > 0
    || input.subagentEntryCount > 0
    || input.runningCount > 0;
}

/** 活动区的开合状态机（照 ZCode SessionPane 的三个 open 标记的规则）：
 *  初值关（挂载与切会话都回到关）；用户开过之后只要该域还有在跑的保持开着；
 *  在跑数归零就自动收起。ZCode 用三个独立 effect 表达这条规则，这里把规则本身
 *  抽成纯函数，宿主只负责在计数变化时套用它。 */
export function sectionOpenOnCountChange(current: boolean, runningCount: number): boolean {
  return runningCount === 0 ? false : current;
}

/** 强制展开（ZCode：点 composer 的活动徽标）时每区按"自己是否有料"决定开合。 */
export function sectionOpenOnForceExpand(runningCount: number): boolean {
  return runningCount > 0;
}
