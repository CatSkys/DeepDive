import { useState } from "react";
import { X } from "lucide-react";
import { Markdown } from "./Markdown";
import { api } from "../api";
import { t } from "../i18n";
import type { PlanReview } from "../planReview";

// PlanReviewCard：plan-review 提意的决策卡（官方 PlanReviewPanel 移植）。
// 一份计划、一个决策：批准/拒绝应答选项原文 label，继续讨论走 cancel
// （ASK_CANCELLED）。卡片由 question/resolved 帧清除；发送失败回解除
// 忙锁并显示原因（官方 settle 语义）。

export function PlanReviewCard({ eventId, review }: { eventId: string; review: PlanReview }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settle = (send: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    void send().catch((err: unknown) => {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    });
  };
  const decide = (label: string) =>
    settle(() => api.answerQuestion(eventId, [{ id: review.id, selected: [label] }]));
  const discuss = () => settle(() => api.cancelQuestion(eventId));

  return (
    <div className="plan-review-card">
      <div className="head">
        <span className="plan-dot" aria-hidden="true" />
        {t("计划审查")}
      </div>
      <div className="plan-body">
        <Markdown text={review.plan} />
      </div>
      {error && <div className="plan-error" role="status">{error}</div>}
      <div className="actions">
        <button className="btn-plain" disabled={busy} onClick={discuss}>
          {t("继续讨论")}
        </button>
        {review.decline && (
          <button
            className="btn-plain"
            data-tip={review.decline.description}
            disabled={busy}
            onClick={() => decide(review.decline!.label)}
          >
            {review.decline.label}
          </button>
        )}
        <button
          className="btn-primary"
          data-tip={review.approve.description}
          disabled={busy}
          onClick={() => decide(review.approve.label)}
        >
          {review.approve.label}
        </button>
        <button className="q-close" data-tip={t("取消提问")} disabled={busy} onClick={discuss}>
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
