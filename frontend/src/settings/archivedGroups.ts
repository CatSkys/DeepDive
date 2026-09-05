// 归档页的纯数据加工：全局归档集合 ∩ workspace 会计槽（归档不清槽，
// 所以"按项目分组"有据可依），折成项目分组列表；再按搜索词/项目过滤。
// 不碰 React、不发请求——ArchivedSection 只消费结果（可单测）。
import type { SessionSummary, WorkspaceView } from "../types";

interface ArchivedRow {
  sessionId: string;
  title: string;
  updatedAt: number;
}

export interface ArchivedGroup {
  /** null = 无项目：不属于任何 workspace 会计槽的归档会话，恒排最后。 */
  workspaceId: string | null;
  title: string;
  rows: ArchivedRow[];
}

/** 项目筛选下拉里"无项目"的哨兵值（workspace id 不会取这个形态）。 */
export const UNGROUPED = "ungrouped";

export function buildArchivedGroups(
  workspaces: WorkspaceView[],
  sessions: SessionSummary[],
  archivedIds: string[],
  titleOf: (s: SessionSummary) => string,
  ungroupedTitle: string,
): ArchivedGroup[] {
  const archived = new Set(archivedIds);
  const byId = new Map(
    sessions.filter((s) => archived.has(s.sessionId)).map((s) => [s.sessionId, s]),
  );
  const claimed = new Set<string>();
  const groups: ArchivedGroup[] = [];
  const rowOf = (sid: string): ArchivedRow => {
    const s = byId.get(sid)!;
    return { sessionId: s.sessionId, title: titleOf(s), updatedAt: s.updatedAt };
  };
  for (const w of workspaces) {
    const rows = (w.sessionIds ?? []).filter((sid) => byId.has(sid));
    if (rows.length === 0) continue;
    for (const sid of rows) claimed.add(sid);
    groups.push({
      workspaceId: w.workspaceId,
      title: w.title,
      rows: rows.map(rowOf).sort((a, b) => b.updatedAt - a.updatedAt),
    });
  }
  const stray = [...byId.keys()].filter((sid) => !claimed.has(sid));
  if (stray.length > 0) {
    groups.push({
      workspaceId: null,
      title: ungroupedTitle,
      rows: stray.map(rowOf).sort((a, b) => b.updatedAt - a.updatedAt),
    });
  }
  return groups;
}

export function filterArchivedGroups(
  groups: ArchivedGroup[],
  query: string,
  workspaceId: string,
): ArchivedGroup[] {
  const q = query.trim().toLowerCase();
  return groups
    .filter((g) =>
      workspaceId === "" || (workspaceId === UNGROUPED ? g.workspaceId === null : g.workspaceId === workspaceId),
    )
    .map((g) => ({
      ...g,
      rows: q ? g.rows.filter((r) => r.title.toLowerCase().includes(q)) : g.rows,
    }))
    .filter((g) => g.rows.length > 0);
}
