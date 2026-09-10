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
  toolCallCount: number;
  /** 回答之前的中间 assistant 消息数。 */
  messageCount: number;
  subagentCount: number;
  /** 最终回答是否内嵌思考（折叠时连同 Thinking 一并隐藏）。 */
  inlineReasoning: boolean;
}

function isSubagentTool(name: string | undefined): boolean {
  return !!name && (name === "subagent" || name.startsWith("subagent_"));
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
  let toolCallCount = 0;
  let messageCount = 0;
  let subagentCount = 0;
  for (let i = 0; i < answerIndex; i++) {
    const it = items[i];
    if (it.kind === "user" || it.kind === "turn-tail") continue;
    if (!PROCESS_KINDS.has(it.kind)) continue;
    processIndices.push(i);
    if (it.kind === "tool-call") {
      if (isSubagentTool(it.toolName)) subagentCount += 1;
      else toolCallCount += 1;
    } else if (it.kind === "assistant") {
      messageCount += 1;
    }
  }

  const blocks = items[answerIndex].event ? blocksOf(items[answerIndex].event) : null;
  const inlineReasoning = !!(blocks?.think && blocks.think.trim());

  if (processIndices.length === 0 && !inlineReasoning) return null;
  return { answerIndex, processIndices, toolCallCount, messageCount, subagentCount, inlineReasoning };
}

/**
 * 披露条文案（官方 message.turnProcess.* 口径：N 次工具调用 · N 条消息 ·
 * N 个 subagent；全空则「已思考」）。
 * @param info - computeTurnProcess 结果。
 * @param tt - i18n 双语插值（tt(zh, en, vars)）。
 */
export function turnProcessLabel(
  info: TurnProcessInfo,
  tt: (zh: string, en: string, vars?: Record<string, string | number>) => string,
): string {
  const labels: string[] = [];
  if (info.toolCallCount > 0) {
    labels.push(tt("{n} 次工具调用", "{n} tool calls", { n: info.toolCallCount }));
  }
  if (info.messageCount > 0) {
    labels.push(tt("{n} 条中间消息", "{n} intermediate messages", { n: info.messageCount }));
  }
  if (info.subagentCount > 0) {
    labels.push(tt("{n} 个 subagent", "{n} subagents", { n: info.subagentCount }));
  }
  if (labels.length === 0) return tt("已思考", "Thought for a while");
  return labels.join(" · ");
}
