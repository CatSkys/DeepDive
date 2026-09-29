// 侧栏搜索的结果整形：把命中会话按来源空间分组（§2.5）。纯数据，不碰渲染。
// 标题命中与全文命中去重合并——标题优先，内容命中带 snippet 行；搜索域＝用户
// 列表层 + 归档（归档只是列表归属，不该搜不到），本地已删的除外。
import { sessionTitle } from "./sessionTitle";
import { isSidebarSession } from "./backgroundSession";
import type { SessionSummary, WorkspaceView } from "../types";

/** 一组会话：label 为分组标题（"" = 不出标题行，单空间部署即用这个）。 */
export interface SessionGroup {
  label: string;
  items: SessionSummary[];
}

export function searchGroups({
  query,
  lang,
  sessions,
  workspaces,
  wsOfSession,
  contentHits,
}: {
  query: string;
  lang: "zh" | "en";
  /** 搜索域：store.allSessions（已含归档）。 */
  sessions: SessionSummary[];
  workspaces: WorkspaceView[];
  /** 会话 → 空间归属（store 建的索引；未命中的按惯例归第一个空间）。 */
  wsOfSession: Map<string, string>;
  /** 全文命中片段（sessionId → snippet）。 */
  contentHits: Map<string, string>;
}): SessionGroup[] {
  if (!query) return [];
  const q = query.trim().toLowerCase();
  const visible = sessions.filter((s) => isSidebarSession(s));
  const hits = visible.filter((s) => sessionTitle(s, lang).toLowerCase().includes(q));
  const hitIds = new Set(hits.map((s) => s.sessionId));
  const contentOnly = visible.filter((s) => !hitIds.has(s.sessionId) && contentHits.has(s.sessionId));
  const merged = [...hits, ...contentOnly];
  // 没有工作空间面时（workspaces 为空）全部会话视为"当前空间"，不出分组标题。
  if (workspaces.length === 0) return [{ label: "", items: merged }];
  const byWs = new Map<string, SessionSummary[]>();
  for (const s of merged) {
    // 不在任何空间的会话按惯例归第一个空间
    const wid = wsOfSession.get(s.sessionId) ?? workspaces[0].workspaceId;
    const arr = byWs.get(wid);
    if (arr) arr.push(s); else byWs.set(wid, [s]);
  }
  return workspaces
    .filter((w) => byWs.has(w.workspaceId))
    .map((w) => ({ label: w.title, items: byWs.get(w.workspaceId)! }));
}
