// 轮内过程自动折叠（官方 ui-chat turn-process 的移植）：已完成回答前的
// 工具/中间消息/思考默认收成一条摘要披露。纯函数计算边界，不管渲染
// （SessionView 消费）。仅对已闭合（存在 turn-tail）且有最终 assistant
// 正文的轮生效；工具-only / 失败空轮不折（官方 answerAnchorSeq===null 口径）。
import type { RenderItem } from "./renderModel";
import { blocksOf } from "./eventText";

/** 可被过程折叠吸收的项种类（官方 TURN_PROCESS_INDEPENDENT_KINDS 的补集）。 */
const PROCESS_KINDS: ReadonlySet<RenderItem["kind"]> = new Set([
  "assistant",
  "tool-call",
  "chunk",
  "reasoning",
  "command",
  "compaction",
  "retry",
  "workflow",
]);

export interface TurnProcessInfo {
  /** 组内最终回答 assistant 的下标；无回答时为 -1（本函数不返回这种值）。 */
  answerIndex: number;
  /** 组内可折叠过程项下标（严格在 answer 之前）。 */
  processIndices: readonly number[];
  /** 本轮工作时长（轮首项 → turn-tail；异常负值钳 0）。披露条标题用。 */
  durationMs: number;
  /** 最终回答是否内嵌思考（折叠时连同 Thinking 一并隐藏）。 */
  inlineReasoning: boolean;
}

/**
 * 计算一组 turn items 的过程折叠边界。
 * @param items - 一个 TurnGroup 的完整 items（含 user / turn-tail）。
 * @returns 可折叠时的过程描述；不可折叠（未闭合/无最终正文/无过程）回 null。
 */
export function computeTurnProcess(items: readonly RenderItem[]): TurnProcessInfo | null {
  const tailIndex = items.findIndex((i) => i.kind === "turn-tail");
  if (tailIndex < 0) return null;

  let answerIndex = -1;
  for (let i = tailIndex - 1; i >= 0; i--) {
    if (items[i].kind === "assistant") {
      answerIndex = i;
      break;
    }
  }
  if (answerIndex < 0) return null;

  const processIndices: number[] = [];
  for (let i = 0; i < answerIndex; i++) {
    const it = items[i];
    if (it.kind === "user" || it.kind === "turn-tail") continue;
    if (!PROCESS_KINDS.has(it.kind)) continue;
    processIndices.push(i);
  }

  const blocks = items[answerIndex].event ? blocksOf(items[answerIndex].event) : null;
  const inlineReasoning = !!(blocks?.think && blocks.think.trim());

  if (processIndices.length === 0 && !inlineReasoning) return null;
  const start = items[0]?.time ?? 0;
  const end = items[tailIndex]?.time ?? start;
  return {
    answerIndex,
    processIndices,
    durationMs: Math.max(0, end - start),
    inlineReasoning,
  };
}

/**
 * 披露条标题（用户定稿，对齐官方）：「已工作 5 分 17 秒」——只给工作时长，
 * 不再罗列工具分组（那面信息展开过程可见）。秒级 <1 分钟只给秒；过小时
 * 分位四舍五入为 0 也只给秒。
 * @param durationMs - computeTurnProcess 的时长。
 * @param tt - i18n 双语插值（tt(zh, en, vars)）。
 */
export function turnWorkLabel(
  durationMs: number,
  tt: (zh: string, en: string, vars?: Record<string, string | number>) => string,
): string {
  const { h, m, s } = elapsedParts(durationMs);
  if (h > 0) return tt("已工作 {h} 小时 {m} 分", "Worked {h}h {m}m", { h, m });
  if (m > 0) return tt("已工作 {m} 分 {s} 秒", "Worked {m}m {s}s", { m, s });
  return tt("已工作 {s} 秒", "Worked {s}s", { s });
}

/**
 * 时长拆成时/分/秒（`turnWorkLabel` 与 `thinkingLabel` 共用这一把尺子）。
 * @param ms - 毫秒；负值按 0 钳（时钟回拨/异常时间戳）。
 */
export function elapsedParts(ms: number): { h: number; m: number; s: number } {
  const total = Math.floor(Math.max(0, ms) / 1000);
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}

/**
 * 已结束的思考行标题（用户定稿，参考 ZCode 的「思考 · 持续了 18 秒」）：只给时长，
 * 与披露条的「已工作 X」同一套分段（秒级只给秒；过小时分位为 0 也只给到分）。
 * @param ms - thinkMs（推理首帧 → 末帧）。
 * @param tt - i18n 双语插值。
 */
export function thinkingLabel(
  ms: number,
  tt: (zh: string, en: string, vars?: Record<string, string | number>) => string,
): string {
  const { h, m, s } = elapsedParts(ms);
  if (h > 0) return tt("思考 · 持续了 {h} 小时 {m} 分", "Thought · {h}h {m}m", { h, m });
  if (m > 0) return tt("思考 · 持续了 {m} 分 {s} 秒", "Thought · {m}m {s}s", { m, s });
  return tt("思考 · 持续了 {s} 秒", "Thought · {s}s", { s });
}
