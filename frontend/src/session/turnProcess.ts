// 轮内过程自动折叠（官方 ui-chat turn-process 的移植）：已完成回答前的
// 工具/中间消息/思考默认收成一条摘要披露。纯函数计算边界，不管渲染
// （SessionView 消费）。仅对已闭合（存在 turn-tail）且有最终 assistant
// 正文的轮生效；工具-only / 失败空轮不折（官方 answerAnchorSeq===null 口径）。
import type { RenderItem } from "./renderModel";
import { blocksOf } from "./eventText";
import { buildDiffRows } from "../diffModel";
import { TOOL_VARIANT_LABEL, TOOL_VARIANT_ORDER, toolVariant, type ToolVariant } from "./toolKind";

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
  /** 工具调用按语义族分组计数（读取/编辑/命令/搜索/代码/技能/提问/其他）。 */
  byVariant: Partial<Record<ToolVariant, number>>;
  /** 编辑类工具累计的增删行数（无 diff 时为 0）。 */
  diff: { added: number; removed: number };
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
  const byVariant: Partial<Record<ToolVariant, number>> = {};
  let toolCallCount = 0;
  let messageCount = 0;
  let subagentCount = 0;
  const diff = { added: 0, removed: 0 };
  for (let i = 0; i < answerIndex; i++) {
    const it = items[i];
    if (it.kind === "user" || it.kind === "turn-tail") continue;
    if (!PROCESS_KINDS.has(it.kind)) continue;
    processIndices.push(i);
    if (it.kind === "tool-call") {
      if (isSubagentTool(it.toolName)) { subagentCount += 1; continue; }
      toolCallCount += 1;
      const variant = toolVariant(it.toolName ?? "");
      byVariant[variant] = (byVariant[variant] ?? 0) + 1;
      // 摘要只需要合计：复用 DiffBlock 的同一份行统计，不另写一份行计数
      if (variant === "edit" && it.diffs) {
        const rows = buildDiffRows(it.diffs);
        diff.added += rows.added;
        diff.removed += rows.removed;
      }
    } else if (it.kind === "assistant") {
      messageCount += 1;
    }
  }

  const blocks = items[answerIndex].event ? blocksOf(items[answerIndex].event) : null;
  const inlineReasoning = !!(blocks?.think && blocks.think.trim());

  if (processIndices.length === 0 && !inlineReasoning) return null;
  return { answerIndex, processIndices, toolCallCount, byVariant, diff, messageCount, subagentCount, inlineReasoning };
}

/**
 * 披露条文案：工具按语义族分组（读取 3 · 编辑 2 [+12 −3] · 命令 4），再挂中间
 * 消息与 subagent 计数；全空回「已思考」。官方文案只给一个「N 次工具调用」的
 * 总量（见 `docs/SPEC-AUTOMATION.md` 之外的历史提交），这里按用户定稿换成分组
 * 口径——收起后一眼能看出这一轮干了什么、改了多少行。
 * @param info - computeTurnProcess 结果。
 * @param tt - i18n 双语插值（tt(zh, en, vars)）。
 */
export function turnProcessLabel(
  info: TurnProcessInfo,
  tt: (zh: string, en: string, vars?: Record<string, string | number>) => string,
): string {
  const labels: string[] = [];
  for (const variant of TOOL_VARIANT_ORDER) {
    const n = info.byVariant[variant] ?? 0;
    if (n === 0) continue;
    const [zh, en] = TOOL_VARIANT_LABEL[variant];
    let segment = `${tt(zh, en)} ${n}`;
    if (variant === "edit" && (info.diff.added > 0 || info.diff.removed > 0)) {
      segment += ` [+${info.diff.added} −${info.diff.removed}]`;
    }
    labels.push(segment);
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
