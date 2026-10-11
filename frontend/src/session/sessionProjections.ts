// 会话摘要的用量/占用投影取数：Composer 的容量圈与页头的计划模式芯片共用这一份。
// 引擎投影的 values 是 Record<string, unknown>（wire 契约），这里在边界处做一次
// 显式收敛（铁律 5），渲染端拿具体形状；无投影时 ctxData 全空、plan 为 undefined
//（AUD-073：计划态由投影轮询纠偏，本端不记状态）。
import type { SessionSummary } from "../types";

export interface SessionCtxData {
  projected?: number;
  window?: number;
  usage?: {
    uncachedInputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  stats?: {
    turns?: number;
    steps?: number;
    llmMs?: number;
    toolMs?: number;
    ttftMs?: number;
    ttftSteps?: number;
    decodeMs?: number;
    decodeTokens?: number;
  };
  breakdown?: {
    systemTokens?: number;
    toolsTokens?: number;
    messageTokens?: number;
  };
}

export interface SessionPlan {
  active: boolean;
  pending: boolean;
}

export function sessionProjections(summary?: SessionSummary): {
  ctxData: SessionCtxData;
  plan?: SessionPlan;
} {
  const vals = (summary?.projections?.values ?? {}) as {
    tokenUsage?: SessionCtxData["usage"];
    contextPressure?: { projectedTokens?: number; contextWindow?: number };
    contextBreakdown?: SessionCtxData["breakdown"];
    sessionStats?: SessionCtxData["stats"];
    plan?: { active?: boolean; pending?: boolean };
  };
  const planProj = vals.plan;
  return {
    ctxData: {
      projected: vals.contextPressure?.projectedTokens,
      window: vals.contextPressure?.contextWindow,
      usage: vals.tokenUsage,
      stats: vals.sessionStats,
      breakdown: vals.contextBreakdown,
    },
    plan: planProj ? { active: !!planProj.active, pending: !!planProj.pending } : undefined,
  };
}
