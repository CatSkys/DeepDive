import type { RenderItem } from "./session/renderModel";

// 轮分组：把渲染项流按 turn 分组，供轮内过程折叠、大纲轨定位与轮容器
// 渲染。纯函数，vitest 钉住边界语义。

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
 * - **插话（steer）不是轮前项**：引擎把它插在**当前轮的中途**（turn/start 与
 *   turn/end 之间，走 next-step 领取，见 agent-loop 的 preStep/claim），官方 UI
 *   按事件时序摆在原地。判据是"轮还开着"（该组还没有 turn-tail）——轮前项一定
 *   落在上一轮 turn/end 之后，此时上一组已带 tail。当轮前项折到轮首会把插话挪到
 *   本轮开头（用户报"插队消息生效后跑到上面去"）；
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
    if (item.kind === "user") {
      const last = groups[groups.length - 1];
      const open = last !== undefined && !last.items.some((it) => it.kind === "turn-tail");
      if (open) last.items.push(item); // 插话：留在轮内原位
      else preTurn.push(item);
      continue;
    }
    const turn = item.turn ?? null;
    if (turn !== null) flushPreInto(turn);
    const last = groups[groups.length - 1];
    // 无 turn 的非 user 项（漏标/历史夹具）并入上一组，绝不为它另开 null 组：
    // 碎片 null 组会打断轮序列，大纲轨与轮分组语义随之错位（「大纲有轮、
    // 正文没有」事故）。摄取侧已给 command/retry/compaction/workflow 标 turn。
    if (turn === null && last) {
      last.items.push(item);
      continue;
    }
    if (last && last.turn === turn) last.items.push(item);
    else groups.push({ turn, items: [item] });
  }
  if (preTurn.length > 0) groups.push({ turn: null, items: preTurn });
  return groups;
}
