// 审批与提问卡（R-007 从 SessionView 搬出）：ApprovalCard（approval/requested
// 帧，经 /api/respond 应答）、QuestionCard（ask_user_question 流）。

import { useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { api } from "../api";
import { t } from "../i18n";
import { useCompositionGuard } from "../useCompositionGuard";
import { IconQuestionOutline14 } from "../components/Icons";
export function ApprovalCard({ approvalId, rpcId, sessionId, toolName, reason }: { approvalId: string; rpcId?: string; sessionId: string; toolName: string; reason?: string }) {
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const answer = async (outcome: "allowed-once" | "rejected") => {
    if (!rpcId) return;
    setPending(true);
    try {
      await api.answerApproval({ rpcId, sessionId, approvalId, outcome });
      setDone(true);
    } catch {
      setPending(false); // 应答提交失败：按钮恢复可点重试（卡片清除仅由 approval/resolved 帧驱动）
    }
  };
  return (
    <div className="approval-card">
      <div className="head">
        <ShieldCheck size={15} />
        {t("请求授权")}
      </div>
      <div className="cmd">{reason || toolName}</div>
      <div className="actions">
        <button className="btn-plain" disabled={done || pending || !rpcId} onClick={() => void answer("rejected")}>
          <X size={13} style={{ verticalAlign: -2 }} /> {t("拒绝")}
        </button>
        <button className="btn-primary" disabled={done || pending || !rpcId} onClick={() => void answer("allowed-once")}>
          {t("允许一次")}
        </button>
      </div>
    </div>
  );
}


/** 意图澄清卡片 — 官方 ui-user-questions QuestionComposer 的卡片化移植。
 *  单选题点击即锁定并推进（最后一题自动提交整批答案）；多选题勾选后用
 *  底部按钮推进；每题可跳过（selected: []）；关闭 = ASK_CANCELLED。
 *  应答回传请求信封上的 rpcId，卡片由 question/resolved 帧清除。 */
export function QuestionCard({ rpcId, sessionId, questions }: {
  rpcId: string;
  sessionId: string;
  questions: Array<{ id: string; question: string; header?: string; detail?: string; options?: Array<{ label: string; description?: string }>; multiSelect?: boolean }>;
}) {
  const [page, setPage] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, { selected: string[]; custom?: string }>>({});
  const [custom, setCustom] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const ime = useCompositionGuard();
  const q = questions[Math.min(page, questions.length - 1)];
  if (!q) return null;
  const multi = q.multiSelect === true;
  const options = q.options ?? [];
  const draft = drafts[q.id];
  const isLast = page >= questions.length - 1;

  const setDraft = (next: { selected: string[]; custom?: string }) => {
    setDrafts((prev) => ({ ...prev, [q.id]: next }));
  };

  const submitAll = async (final: Record<string, { selected: string[]; custom?: string }>) => {
    setSubmitting(true);
    try {
      await api.answerQuestion({
        rpcId,
        sessionId,
        answers: questions.map((item) => {
          const d = final[item.id] ?? { selected: [] };
          return { id: item.id, selected: d.selected, ...(d.custom ? { custom: d.custom } : {}) };
        }),
      });
      // 卡片由 question/resolved 帧负责移除；这里只防重复提交。
    } catch {
      setSubmitting(false); // 引擎不可达：留在卡片上可重试
    }
  };

  const advanceOrSubmit = async (next: { selected: string[]; custom?: string }) => {
    const final = { ...drafts, [q.id]: next };
    setDrafts(final);
    if (isLast) {
      await submitAll(final);
    } else {
      setCustom("");
      setPage((p) => p + 1);
    }
  };

  const pick = async (label: string) => {
    if (multi) {
      const sel = draft?.selected ?? [];
      const next = sel.includes(label) ? sel.filter((s) => s !== label) : [...sel, label];
      setDraft({ selected: next });
    } else {
      await advanceOrSubmit({ selected: [label] });
    }
  };

  const skip = () => void advanceOrSubmit({ selected: [] });
  const sendCustom = () => {
    const text = custom.trim();
    if (!text) return;
    void advanceOrSubmit(multi ? { selected: draft?.selected ?? [], custom: text } : { selected: [], custom: text });
  };
  const cancel = async () => {
    setSubmitting(true);
    try { await api.cancelQuestion(rpcId); } catch { setSubmitting(false); /* 应答提交失败：卡片保持可再点重试（帧清除仅由 resolved 驱动） */ }
  };

  return (
    <div className="question-card">
      <div className="head">
        <IconQuestionOutline14 size={14} />
        {t("澄清一下")}
        {questions.length > 1 && <span className="pager">{page + 1}/{questions.length}</span>}
        <button className="q-close" data-tip={t("取消提问")} disabled={submitting} onClick={() => void cancel()}>
          <X size={13} />
        </button>
      </div>
      {q.header && <div className="q-header">{q.header}</div>}
      <div className="q-text">{q.question}</div>
      {q.detail && <div className="q-detail">{q.detail}</div>}
      {options.length > 0 && (
        <div className="q-options">
          {options.map((o) => {
            const active = (draft?.selected ?? []).includes(o.label);
            return (
              <button
                key={o.label}
                className={`q-option${active ? " active" : ""}`}
                disabled={submitting}
                onClick={() => void pick(o.label)}
              >
                <span className="q-option-mark" aria-hidden="true" />
                <span className="q-option-body">
                  <span className="q-option-label">{o.label}</span>
                  {o.description && <span className="q-option-desc">{o.description}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="q-custom">
        <input
          placeholder={t("自定义回答…")}
          value={custom}
          disabled={submitting}
          onChange={(e) => setCustom(e.target.value)}
          onCompositionStart={ime.onCompositionStart}
          onCompositionEnd={ime.onCompositionEnd}
          onKeyDown={(e) => {
            if (ime.swallow(e)) return;
            if (e.key === "Enter") {
              e.preventDefault();
              sendCustom();
            }
          }}
        />
      </div>
      <div className="actions">
        <button className="btn-plain" disabled={submitting} onClick={skip}>
          {t("跳过此题")}
        </button>
        {multi && (
          <button
            className="btn-primary"
            disabled={submitting || (draft?.selected ?? []).length === 0}
            onClick={() => void advanceOrSubmit({ selected: draft?.selected ?? [], custom: custom.trim() || undefined })}
          >
            {isLast ? t("提交") : t("下一题")}
          </button>
        )}
      </div>
    </div>
  );
}

