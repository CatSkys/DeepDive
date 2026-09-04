import type { RenderItem } from "./session/renderModel";

// 轮折叠（3.3 面的补齐项）：把渲染项流按轮分组，供长会话把早前轮折叠成
// 一条弱化摘要。纯函数，vitest 钉住边界语义。

export interface TurnGroup {
  /** 轮号；日志开头先于首个 turn/start 的项归 null 组（罕见）。 */
  turn: number | null;
  items: RenderItem[];
}

/**
 * 分组规则（对齐事件时序语义）：
 * - 带 turn 的项（assistant/tool/chunk/turn-tail…）开启或延续自己的轮；
 * - user 是"轮前项"——它们先于自己触发的 turn/start 到达，
 *   挂到**下一个**轮；
 * - command/retry/workflow/compaction 是"轮内项"——发生在 turn/start 之后，
 *   挂到**当前**轮；日志开头尚无轮时先入 null 组。
 */
export function groupTurns(items: readonly RenderItem[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  let preTurn: RenderItem[] = []; // 尚无所属轮的轮前项
  const flushPreInto = (turn: number) => {
    if (preTurn.length === 0) return;
    const last = groups[groups.length - 1];
    if (last && last.turn === turn) last.items.unshift(...preTurn);
    else groups.push({ turn, items: [...preTurn] });
    preTurn = [];
  };
  for (const item of items) {
    const pre = item.kind === "user";
    if (pre) {
      preTurn.push(item);
      continue;
    }
    const turn = item.turn ?? null;
    if (turn !== null) flushPreInto(turn);
    const last = groups[groups.length - 1];
    if (last && last.turn === turn) last.items.push(item);
    else groups.push({ turn, items: [item] });
  }
  if (preTurn.length > 0) groups.push({ turn: null, items: preTurn });
  return groups;
}

/** 折叠决策：轮数达到阈值时，除最近 keepRecent 轮外全部折叠。 */
export function foldDecision(groupCount: number, threshold = 5, keepRecent = 2): { foldFrom: number } | null {
  if (groupCount < threshold) return null;
  return { foldFrom: Math.max(0, groupCount - keepRecent) };
}
