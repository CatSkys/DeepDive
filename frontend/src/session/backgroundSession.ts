// 后台会话的判据与命名（唯一事实源）：哪些会话是机器开的、在用户列表里怎么处置。
//
// 判据形态照 MiMo-Code 的 `session/visibility.ts` + `session/auto-dream.ts`：
// 读**会话自身的属性**（我们可读的是投影标题 `projections.values.title`），
// 而不是应用侧另存一份 id 台账——那份台账活在会话之外，会随 localStorage 一起丢，
// 且对"台账之前就建好的会话"失效（MiMo 的注释记着他们的代理判据误杀过 28 个真会话）。
//
// 两层处置也照 MiMo：
// - `badge`（整理类：复盘/整理）＝ MiMo 的 dream/distill——是可以读的整理工作，
//   留在列表里、加自动标识；TUI 里它们就是带 `[Auto]` 徽章显示的。
// - `hidden`（执行类：落库/撤销，以及自动化的每次运行）＝ MiMo 的 checkpoint-writer
//   宿主——只为跑机器动作而存在的会话，不进用户列表（各功能自己的「运行历史」
//   仍可打开：那是审计路径）。
//
// fail-open 照 MiMo：读不到标题（无投影/老会话）一律判**不是**后台会话——
// 宁可多显示一个真会话，不可少显示一个。

import type { SessionSummary } from "../types";

/** 后台会话标题的统一前缀（生产者与判据共用的唯一一份）。 */
export const EVOLUTION_PREFIX = "自进化·";
export const AUTOMATION_PREFIX = "自动化·";

/** 整理类（留列表 + 自动标识）。 */
export const CONSOLIDATE_TITLES = [
  `${EVOLUTION_PREFIX}复盘`,
  `${EVOLUTION_PREFIX}整理`,
  `${EVOLUTION_PREFIX}整理（引擎目录）`,
] as const;

/** 执行类（不进列表）：落库会话按作用域各一条，长期复用（MiMo 式固定系统标题）。 */
export const REPO_TASK_TITLE = `${EVOLUTION_PREFIX}落库`;
export const HOME_TASK_TITLE = `${EVOLUTION_PREFIX}落库（引擎目录）`;

/** 自动化每次运行的会话标题（任务名便于在运行历史里辨认）。 */
export function automationRunTitle(taskTitle: string): string {
  const name = taskTitle.trim();
  return `${AUTOMATION_PREFIX}${name === "" ? "运行" : name}`;
}

/** 会话的归类：null = 用户会话照常显示。 */
export type BackgroundTier = "badge" | "hidden";

/** 单个会话的处置。读不到标题 → null（fail-open，见文件头）。 */
export function backgroundTier(s: SessionSummary): BackgroundTier | null {
  const raw = (s.projections?.values as { title?: unknown } | undefined)?.title;
  if (typeof raw !== "string") return null;
  const title = raw.trim();
  if (title === "") return null;
  if ((CONSOLIDATE_TITLES as readonly string[]).includes(title)) return "badge";
  if (title.startsWith(EVOLUTION_PREFIX)) return "hidden";
  if (title.startsWith(AUTOMATION_PREFIX)) return "hidden";
  return null;
}

/** 是否不进用户会话列表（执行类后台会话）。 */
export function isHiddenSession(s: SessionSummary): boolean {
  return backgroundTier(s) === "hidden";
}

/** 是否带自动标识显示（整理类后台会话）。 */
export function isBadgedSession(s: SessionSummary): boolean {
  return backgroundTier(s) === "badge";
}
