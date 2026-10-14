// 「这一页看得见什么」的唯一判据（纯函数，不含 React）：引擎侧的「快捷会话」是一个
// 普通空间，但它是悬浮面板那条线的窗口——主窗既不列它这个空间，也不列它的会话
//（用户 2026-10-14：「悬浮快捷会话不在主面板中显示」）；面板页反过来照旧全量，面板的
// 历史/锚点全指着它。store 只在这里问两次（空间列表一次、会话列表一次），其余各处读
// store 已筛好的那份——各处自己 filter 一遍就是漏一处的开始。
import type { SessionSummary, WorkspaceView } from "../types";

/** 这一页的空间列表：主窗摘掉快捷空间，面板那条线全量（顺序不动——⌥N 与切换器
 *  共用同一份编号）。 */
export function workspacesOnPage(
  all: readonly WorkspaceView[],
  quickWorkspaceId: string | null,
  panelPage: boolean,
): WorkspaceView[] {
  if (panelPage || quickWorkspaceId === null) return [...all];
  return all.filter((w) => w.workspaceId !== quickWorkspaceId);
}

/** 这一页要摘掉的会话：主窗摘掉归在快捷空间里的那些，面板那条线一条不摘。
 *  归属表必须传**引擎全量空间**建的那张（store/wsMap.ts）——拿筛过的空间建表会让
 *  快捷会话匹配不上、落到主窗第一个空间去，正好漏进主窗。 */
export function sessionsOnPage(
  list: readonly SessionSummary[],
  wsOf: ReadonlyMap<string, string>,
  quickWorkspaceId: string | null,
  panelPage: boolean,
): SessionSummary[] {
  if (panelPage || quickWorkspaceId === null) return [...list];
  return list.filter((s) => wsOf.get(s.sessionId) !== quickWorkspaceId);
}
