// 刻度轨活动轮判定（纯函数，语义照官方 ui-chat ChatView.syncActiveTurn）；
// 两条关键规则，我们此前的移植漏了前者、写错后者，表现为"贴底时活动刻度
// 总比最新少一轮"：
//  ① 贴底（跟随最新，阈值 24px）→ 活动轮就是最后一轮。否则滚动到底时
//     阅读线永远落在倒数第二轮里，新轮拿不到刻度。
//  ② 否则按阅读线（视口顶 + min(96, 20% 高)）取上方最新一轮——旧实现用
//     40% 高，线压得太低，同样偏旧。
// ③ 阅读线之上没有任何轮 → 首轮（官方：flow head still owns the mark）。

/** 贴底阈值（官方 FOLLOW_THRESHOLD）。 */
export const FOLLOW_THRESHOLD = 24;

/** 阅读线偏移：视口顶 + min(96, 20% 视口高)（官方同款）。 */
export function readingLineOffset(clientHeight: number): number {
  return Math.min(96, clientHeight * 0.2);
}

/**
 * @param atBottom 是否贴底（跟随最新）。
 * @param readingTurn 阅读线上方最新的轮号；线之上无轮时 null。
 * @param railTurns 刻度轨实际提供的轮号（升序）——轮号可能不连续（隐藏轮不占刻度）。
 * @returns 该占活动刻度的轮号；刻度为空时 null。
 */
export function activeTurnFor(
  atBottom: boolean,
  readingTurn: number | null,
  railTurns: readonly number[],
): number | null {
  if (railTurns.length === 0) return null;
  if (atBottom) return railTurns[railTurns.length - 1];
  // 映射到刻度轨真的提供的那一轮：比阅读轮新的一律不取（官方同款循环）
  let next = railTurns[0];
  if (readingTurn !== null) {
    for (const turn of railTurns) {
      if (turn > readingTurn) break;
      next = turn;
    }
  }
  return next;
}
