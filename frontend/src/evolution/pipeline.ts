// 自进化自动管线的选择器（纯函数）：给出台账与节流状态，决定下一步动作。
// 判定在这里（可单测），执行在 useEvolution（副作用在那）——零人审后"下一步
// 做什么"完全由状态机决定，人只审计。
// 出处：机械门顺序与退役语义照 dsh-evolve-modes 的状态机；无效即撤照 penguin
// 「再评估不提升才保留」的反面；节奏照 MiMo Dream（7 天）+ 我们的日节流（§9.0.4）。

import type { LessonProposal } from "./protocol";

/** 每日自动落地条数上限（dsh-evolve-modes 的学习批次默认 3）。 */
export const APPLY_DAILY_CAP = 3;
/** 落地确认连续失败到这个次数即退役（重试有限度，不无限烧）。 */
export const APPLY_RETRY_MAX = 2;
/** 落地确认的节流：已交办未确认的提案别每分钟跑一次 git。 */
export const LAND_THROTTLE_MS = 5 * 60_000;
/** 校验重发守卫：回执丢了按这个间隔重派（P0 修复的护栏）。 */
export const VERIFY_RETRY_MS = 30 * 60_000;
/** 整理环节奏：7 天（MiMo Dream 的固定周期）。 */
export const CONSOLIDATE_INTERVAL_MS = 7 * 24 * 3600_000;
/** 复盘日节流（SPEC §9.0.4）。 */
export const REVIEW_INTERVAL_MS = 24 * 3600_000;
/** 复盘静默兜底：7 天完全没复盘也跑一轮（不能只等"用户正在受苦"才学习）。 */
export const REVIEW_IDLE_MS = 7 * 24 * 3600_000;

export type EvolutionAction =
  | { kind: "gate"; id: string }
  | { kind: "apply"; id: string }
  | { kind: "land"; id: string }
  | { kind: "verify"; id: string }
  | { kind: "revoke"; id: string }
  | { kind: "review" }
  | { kind: "consolidate" }
  | null;

export interface PipelineCtx {
  now: number;
  /** 模型会话交办在途（apply/revoke/review/consolidate 互斥）；本机脚本不占。 */
  busy: boolean;
  lastReviewAt: number | null;
  lastConsolidateAt: number | null;
  /** 今日已自动落地条数。 */
  appliedToday: number;
  /** 上次复盘后有会话更新（复盘触发条件之一）。 */
  sessionsTouched: boolean;
  gateInFlight: ReadonlySet<string>;
  landInFlight: ReadonlySet<string>;
  verifyInFlight: ReadonlySet<string>;
}

export function nextAction(proposals: readonly LessonProposal[], c: PipelineCtx): EvolutionAction {
  // ① 无效即撤：效果判定不合格的已落地条目自动回滚（penguin：不提升不保留）。
  const bad = proposals.find((p) => p.verdict?.verdict === "ineffective" && p.status === "applied" && p.revokeAt === undefined);
  if (bad && !c.busy) return { kind: "revoke", id: bad.id };

  // ② 机械门（本机）：pending 且未过门的先验证据与锚点。
  const toGate = proposals.find((p) => p.status === "pending" && p.gate === undefined && !c.gateInFlight.has(p.id));
  if (toGate) return { kind: "gate", id: toGate.id };

  // ③ 自动落地（模型会话，限速）：过了门、按提出先后排队、当日额度未满。
  if (!c.busy && c.appliedToday < APPLY_DAILY_CAP) {
    const toApply = proposals
      .filter((p) => p.status === "pending" && p.gate !== undefined && p.gate.verbatim && p.gate.anchorFound)
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (toApply) return { kind: "apply", id: toApply.id };
  }

  // ④ 落地确认（本机）：已交办未确认，按次节流（apply 提示词的写入要时间落盘）。
  const toLand = proposals.find((p) => p.status === "applied" && p.appliedAt !== undefined
    && (p.landing === undefined || !p.landing.landed)
    && (p.lastLandAt === undefined || c.now - p.lastLandAt >= LAND_THROTTLE_MS)
    && !c.landInFlight.has(p.id));
  if (toLand) return { kind: "land", id: toLand.id };

  // ⑤ 到期校验（本机）：已落地、窗口从采纳时刻起算、未判过、重发守卫内。
  const due = proposals.find((p) => p.status === "applied" && p.predict !== null && p.verdict === undefined
    && p.landing !== undefined && p.landing.landed
    && c.now - (p.appliedAt ?? p.createdAt) >= p.predict.windowDays * 86_400_000
    && (p.lastVerifyAt === undefined || c.now - p.lastVerifyAt >= VERIFY_RETRY_MS)
    && !c.verifyInFlight.has(p.id));
  if (due) return { kind: "verify", id: due.id };

  // ⑥ 复盘（模型会话）：日节流 + 有新会话；或 7 天静默兜底。
  if (!c.busy) {
    const since = c.lastReviewAt === null ? Number.POSITIVE_INFINITY : c.now - c.lastReviewAt;
    if (since >= REVIEW_INTERVAL_MS && (c.sessionsTouched || since >= REVIEW_IDLE_MS)) return { kind: "review" };
  }

  // ⑦ 整理环（模型会话）：7 天一轮（MiMo Dream）。
  if (!c.busy) {
    const since = c.lastConsolidateAt === null ? Number.POSITIVE_INFINITY : c.now - c.lastConsolidateAt;
    if (since >= CONSOLIDATE_INTERVAL_MS) return { kind: "consolidate" };
  }

  return null;
}

/** 本地日期键 YYYY-MM-DD（每日限速计数用）。 */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
