// 会话→空间归属表与投影签名段（从 store.tsx 拆出的纯函数）：store 的轮询
// 热路径只用它们做门控比较，不碰任何 React 状态。
import type { SessionSummary, WorkspaceView } from "../types";

/** sessionId → workspaceId 归属表。workspace follow 的 sessionIds 为准；不在任何
 *  空间的会话（引擎未回填的老会话）按 cwd 与空间路径的最长前缀匹配归位；
 *  仍无主 → 第一个空间（引擎序首位＝快捷空间，这类会话因此不算主窗的面孔，只在
 *  面板那条线可见——本地实测无主会话都是早年的、且全已归档）。无工作空间面时返回
 *  空表（全部视为"当前空间"）。
 *  **必须传引擎全量空间**（store 的 allWorkspaces）：传主窗筛过的那份会让快捷会话
 *  匹配不上、落到第一个项目上，正好漏进主窗（见 store/pageVisibility.ts）。 */
export function buildWsMap(workspaces: WorkspaceView[], sessions: SessionSummary[]): Map<string, string> {
  const m = new Map<string, string>();
  if (workspaces.length === 0) return m;
  for (const w of workspaces) for (const sid of w.sessionIds ?? []) m.set(sid, w.workspaceId);
  const byPath = (cwd?: string) => {
    if (!cwd) return undefined;
    let hit: WorkspaceView | undefined;
    for (const w of workspaces) {
      const root = w.path.endsWith("/") ? w.path : `${w.path}/`;
      if (cwd === w.path || cwd.startsWith(root)) {
        if (!hit || w.path.length > hit.path.length) hit = w;
      }
    }
    return hit?.workspaceId;
  };
  for (const s of sessions) {
    if (!m.has(s.sessionId)) m.set(s.sessionId, byPath(s.cwd) ?? workspaces[0].workspaceId);
  }
  return m;
}

/** 每会话投影的紧凑签名段：plan/goal 变化也要换会话列表的身份——plan 芯片与
 *  胶囊的取数已直读这些投影（`projections.values`），签名缺它们时 updateAt
 *  没动的会话列表 identity 不动，消费者就永远看不到新的 plan/goal。
 *  goal 取 updatedAt+revision 两个标量，别逐轮 JSON 序列化整个 objective。 */
export function projectionSig(s: SessionSummary): string {
  const vals = s.projections?.values as Record<string, unknown> | undefined;
  const plan = vals?.plan as { active?: boolean; pending?: boolean } | undefined;
  const goal = vals?.goal as { updatedAt?: number; goal?: { revision?: number } } | undefined;
  const planKey = plan ? `${plan.active ? 1 : 0}${plan.pending ? 1 : 0}` : "-";
  const goalKey = goal ? `${goal.updatedAt ?? "-"}:${goal.goal?.revision ?? "-"}` : "-";
  return `${planKey}:${goalKey}`;
}

