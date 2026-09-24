// 后台会话的判据与命名（唯一事实源）：哪些会话是机器开的、在用户列表里怎么处置。
//
// 判据形态照 MiMo-Code 的 `session/visibility.ts` + `session/auto-dream.ts`：
// 读**会话自身的属性**（我们可读的是投影标题 `projections.values.title`），
// 而不是应用侧另存一份 id 台账——那份台账活在会话之外，会随 localStorage 一起丢，
// 且对"台账之前就建好的会话"失效（MiMo 的注释记着他们的代理判据误杀过 28 个真会话）。
//
// 唯一的后台会话来源是**自动化**：每次运行开一个一次性会话，只为跑机器动作而存在，
// 所以不进用户列表（该任务自己的「运行历史」仍可打开：那是审计路径）。
//
// fail-open 照 MiMo：读不到标题（无投影/老会话）一律判**不是**后台会话——
// 宁可多显示一个真会话，不可少显示一个。

import type { SessionSummary } from "../types";

/** 自动化运行会话的标题前缀（生产者与判据共用的唯一一份）。 */
export const AUTOMATION_PREFIX = "自动化·";

/** 已删除的「自进化」留下的机器会话前缀：**只用于判据**，没有生产者。
 *  那些会话当初就不该进用户列表，功能删了不等于把它们倒进用户的列表里。 */
export const LEGACY_EVOLUTION_PREFIX = "自进化·";

/** 后台会话的保留前缀（判据与改名准入共用）。 */
const HIDDEN_PREFIXES: readonly string[] = [AUTOMATION_PREFIX, LEGACY_EVOLUTION_PREFIX];

/** 自动化每次运行的会话标题（任务名便于在运行历史里辨认）。 */
export function automationRunTitle(taskTitle: string): string {
  const name = taskTitle.trim();
  return `${AUTOMATION_PREFIX}${name === "" ? "运行" : name}`;
}

/** 标题 → 是否属于后台执行类会话（判据本体）。会话形态与"把它改成这个名字会变成
 *  什么"共用这一份——改名入口据此先问一句，别让一次重命名把会话从列表里改没了。
 *  读不到标题 → false（fail-open，见文件头）。 */
export function titleHidesSession(title: string | null): boolean {
  const raw = title?.trim() ?? "";
  return raw !== "" && HIDDEN_PREFIXES.some((prefix) => raw.startsWith(prefix));
}

/** 单个会话的处置。 */
export function isHiddenSession(s: SessionSummary): boolean {
  const raw = (s.projections?.values as { title?: unknown } | undefined)?.title;
  return titleHidesSession(typeof raw === "string" ? raw : null);
}

/** 是否属于"用户列表"这一层（侧栏/搜索/切换空间的落点/自动归档的候选都用它）：
 *  后台运行会话与子代理派生会话不进用户列表（各自的审计入口仍在）。 */
export function isSidebarSession(s: SessionSummary): boolean {
  return !isHiddenSession(s) && s.origin !== "subagent";
}
