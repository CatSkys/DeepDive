// plan-review 收窄规则：官方 ui-user-questions planReviewOf 移植
// （docs/DSH-WIRE.md §6）。只有能被"一张决策卡"完整应答的请求才接管，
// 其余保持通用提问流。纯函数，vitest 钉住。

import type { QuestionItem, QuestionOption } from "./types";

export interface PlanReview {
  /** 被审查题的 id，应答原样回传。 */
  id: string;
  question: string;
  /** 计划正文 markdown（wire 上放 question.detail）。 */
  plan: string;
  /** 批准选项（应答 selected:[label] 用原文 label）。 */
  approve: QuestionOption;
  /** 拒绝选项；提问方未提供第二选项时缺省。 */
  decline?: QuestionOption;
}

export function planReviewOf(questions: readonly QuestionItem[]): PlanReview | undefined {
  if (questions.length !== 1) return undefined;
  const q = questions[0]!;
  const intent = q.intent;
  if (intent?.kind !== "plan-review" || q.detail === undefined) return undefined;
  if (q.multiSelect === true) return undefined;
  const options = q.options ?? [];
  if (options.length > 2) return undefined;
  const approve = options.find((o) => o.label === intent.approve);
  if (!approve) return undefined;
  const decline = options.find((o) => o.label !== intent.approve);
  return { id: q.id, question: q.question, plan: q.detail, approve, ...(decline ? { decline } : {}) };
}
