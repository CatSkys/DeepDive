// 自动归档（用户定稿功能）：保留时长档 + 候选判定（纯函数，便于单测）。
// 豁免：**置顶会话不受归档限制**（用户明确要求）；此外运行中、有未读、以及
// 当前正打开的会话也一律豁免。默认关（opt-in）——归档在本引擎是单向的
// （wire 面只有 workspace/archiveSession，没有 unarchive），误归档无法在 UI 里撤销，
// 所以只有用户显式打开开关才会扫描。

export type ArchiveRetention = "12h" | "24h" | "7d" | "30d";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** 时长档（顺序即下拉顺序）。 */
export const RETENTIONS: ReadonlyArray<{ id: ArchiveRetention; ms: number }> = [
  { id: "12h", ms: 12 * HOUR },
  { id: "24h", ms: 24 * HOUR },
  { id: "7d", ms: 7 * DAY },
  { id: "30d", ms: 30 * DAY },
];

export const DEFAULT_RETENTION: ArchiveRetention = "7d";

/** 扫描间隔：归档不时效敏感，低频即可（每次扫描只读内存里的会话列表）。 */
export const SCAN_INTERVAL_MS = 5 * 60_000;

export function retentionMs(id: ArchiveRetention): number {
  return RETENTIONS.find((r) => r.id === id)?.ms ?? RETENTIONS[2].ms;
}

/** 下拉显示名（i18n 中文源串）。 */
export function retentionLabel(id: ArchiveRetention): string {
  switch (id) {
    case "12h": return "12 小时后归档";
    case "24h": return "24 小时后归档";
    case "7d": return "7 天后归档";
    case "30d": return "30 天后归档";
  }
}

/** 判定所需的会话最小面（SessionSummary 子集，便于单测构造）。 */
export interface ArchiveScanInput {
  sessionId: string;
  updatedAt: number;
  running?: boolean;
}

/** 扫描上下文。 */
export interface ArchiveScanContext {
  /** 置顶集（置顶会话不受归档限制）。 */
  pinned: ReadonlySet<string>;
  /** 未读集。 */
  unread: ReadonlySet<string>;
  /** 当前打开的会话（不归档正在看的）。 */
  activeSessionId: string | null;
  retentionMs: number;
  now: number;
}

/**
 * 扫出可归档的会话 id：已停止运行、无未读、未置顶、不是当前会话，
 * 且最后更新时间早于保留期（严格早于，边界不裁）。
 * @param sessions 会话列表（顺序即返回顺序）。
 * @param ctx 置顶/未读/当前会话与保留期。
 */
export function archiveCandidates(
  sessions: readonly ArchiveScanInput[],
  ctx: ArchiveScanContext,
): string[] {
  const cutoff = ctx.now - ctx.retentionMs;
  return sessions
    .filter((s) =>
      !s.running
      && s.updatedAt < cutoff
      && !ctx.pinned.has(s.sessionId)
      && !ctx.unread.has(s.sessionId)
      && s.sessionId !== ctx.activeSessionId)
    .map((s) => s.sessionId);
}
