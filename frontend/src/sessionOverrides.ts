// 归档/删除的本地覆盖（用户定稿的"不重启引擎"路径）。
//
// 为什么需要覆盖：引脚的引擎 wire 面没有取消归档与删除会话（官方亦然，见
// ui-workspace/README.md），而且实测**引擎把会话列表缓存在内存**——运行中删掉
// 日志目录后 session/list 照样列它。于是 UI 侧的即时真相走本地覆盖集：
//   unarchived：用户取消归档的（引擎仍当它已归档 → 视图上摘掉）
//   removed：用户删除的（引擎仍列它 → 视图上摘掉）
// 两者都持久化在 localStorage，并同步给壳；壳在**下次启动的空窗期**（引擎还没起）
// 把引擎状态文件改到位（SessionAdmin.applyPending），此后覆盖集随观察自动收敛
// （见 converges：引擎不再报告它已归档 / 不再列它时，覆盖项即可丢弃）。

/** 从归档集里摘掉本地取消归档与已删除的。 */
export function visibleArchived(
  archived: ReadonlySet<string>,
  unarchived: ReadonlySet<string>,
  removed: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const id of archived) {
    if (unarchived.has(id) || removed.has(id)) continue;
    out.add(id);
  }
  return out;
}

/** 会话列表里摘掉本地已删除的。 */
export function visibleSessions<T extends { sessionId: string }>(
  sessions: readonly T[],
  removed: ReadonlySet<string>,
): T[] {
  return removed.size === 0 ? sessions.slice() : sessions.filter((s) => !removed.has(s.sessionId));
}

/** 观察收敛：引擎已不再报告为归档 / 已不再列出，则覆盖项可以忘掉。
 *  @param liveArchived 引擎当前报告的归档集（原始值）
 *  @param liveSessionIds 引擎当前列出的会话 id
 *  @returns 应收敛掉的 id（调用方从对应覆盖集里删除） */
export function converged(
  liveArchived: ReadonlySet<string>,
  liveSessionIds: ReadonlySet<string>,
  unarchived: ReadonlySet<string>,
  removed: ReadonlySet<string>,
): { unarchived: string[]; removed: string[] } {
  return {
    unarchived: [...unarchived].filter((id) => !liveArchived.has(id)),
    removed: [...removed].filter((id) => !liveSessionIds.has(id)),
  };
}
