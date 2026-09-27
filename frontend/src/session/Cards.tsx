// 审批与提问卡（R-007 从 SessionView 搬出）：ApprovalCard（$events waterfall
// approval/request，经 $events/result 应答）、QuestionCard（user-questions/
// request 同路）。挂起身份与应答都走 eventId。

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronLeft, ChevronRight, Info, ShieldCheck, X } from "lucide-react";
import { api } from "../api";
import { t } from "../i18n";
import { useStore } from "../store";
import { useCompositionGuard } from "../useCompositionGuard";
import { toolDisplayName } from "./toolKind";
export function ApprovalCard({ eventId, toolName, reason }: { eventId: string; toolName: string; reason?: string }) {
  const [pending, setPending] = useState(false);
  const { settleEvent } = useStore();
  const answer = async (outcome: "allowed-once" | "rejected") => {
    setPending(true);
    try {
      await api.answerApproval(eventId, outcome);
      // 网关不给应答者回 cancel 帧：卡片移除以本地结算为准（官方 answer().then(clear) 同款）。
      settleEvent(eventId);
    } catch {
      setPending(false); // 应答提交失败：按钮恢复可点重试
    }
  };
  return (
    <div className="approval-card">
      {/* 与提问卡同族的徽标头行（流内三卡统一语言） */}
      <div className="q-top">
        <span className="q-badge"><ShieldCheck size={12} /> {t("请求授权")}</span>
      </div>
      <div className="cmd">{reason || toolDisplayName(toolName, t)}</div>
      <div className="actions">
        <button className="btn-plain" disabled={pending} onClick={() => void answer("rejected")}>
          <X size={13} style={{ verticalAlign: -2 }} /> {t("拒绝")}
        </button>
        <button className="btn-primary" disabled={pending} onClick={() => void answer("allowed-once")}>
          {t("允许一次")}
        </button>
      </div>
    </div>
  );
}


/** 意图澄清卡片 — 官方 ui-user-questions QuestionComposer 的移植（用户定稿
 *  版式：题头徽标+问题+分页器一行置顶，选项为无卡片编号行，底部键位提示条）。
 *  单选题点击即锁定并推进（最后一题自动提交整批答案）；多选题勾选后用底部
 *  按钮推进；每题可跳过（selected: []）；关闭 = ASK_CANCELLED。键盘：Tab/
 *  上下键在选项+自定义输入间高亮循环，回车/空格选中。应答按 eventId 经
 *  $events/result 回传；网关不给应答者回 cancel 帧，提交/取消成功即本地
 *  结算清卡（官方 answer().then(clear) 同款）。 */
export function QuestionCard({ eventId, questions }: {
  eventId: string;
  questions: Array<{ id: string; question: string; header?: string; detail?: string; options?: Array<{ label: string; description?: string }>; multiSelect?: boolean }>;
}) {
  const [page, setPage] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, { selected: string[]; custom?: string }>>({});
  const [custom, setCustom] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // 键盘高亮单元：0..options.length-1 为选项，options.length 为自定义输入；
  // -1 = 未开始键盘导航（默认，不预亮任何行，避免无 hover 也出现卡片底）
  const [activeIdx, setActiveIdx] = useState(-1);
  const { settleEvent } = useStore();
  const ime = useCompositionGuard();
  const inputRef = useRef<HTMLInputElement>(null);
  const q = questions[Math.min(page, questions.length - 1)];
  useEffect(() => setActiveIdx(-1), [page]); // 换题回到"未高亮"：无 hover 不预亮任何行
  if (!q) return null;
  const multi = q.multiSelect === true;
  const options = q.options ?? [];
  const units = options.length + 1;
  const kbIdx = Math.min(activeIdx, units - 1);
  const draft = drafts[q.id];
  const isLast = page >= questions.length - 1;

  const setDraft = (next: { selected: string[]; custom?: string }) => {
    setDrafts((prev) => ({ ...prev, [q.id]: next }));
  };

  const submitAll = async (final: Record<string, { selected: string[]; custom?: string }>) => {
    setSubmitting(true);
    try {
      await api.answerQuestion(
        eventId,
        questions.map((item) => {
          const d = final[item.id] ?? { selected: [] };
          return { id: item.id, selected: d.selected, ...(d.custom ? { custom: d.custom } : {}) };
        }),
      );
      // 提交成功即本地结算清卡（见组件注释）；失败留在卡片上可重试。
      settleEvent(eventId);
    } catch {
      setSubmitting(false);
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
    try {
      await api.cancelQuestion(eventId);
      settleEvent(eventId); // 取消成功同样本地结算（网关不给发起者回 cancel 帧）
    } catch {
      setSubmitting(false); // 提交失败：卡片保持可再点重试
    }
  };

  // 键盘选择（提示条所承诺的）：Tab/上下键在高亮单元间循环；回车/空格选中。
  // 焦点在输入框内时方向键归光标、回车=提交自定义（既有行为），Tab 仍可 cycling。
  const onCardKeyDown = (e: React.KeyboardEvent) => {
    if (submitting) return;
    const inInput = (e.target as HTMLElement).tagName === "INPUT";
    const cycle = (delta: number) => {
      e.preventDefault();
      // 从未高亮（-1）出发：下键进第一个单元，上键进最后一个
      const base = kbIdx < 0 && delta < 0 ? units : kbIdx;
      const next = (base + delta + units) % units;
      setActiveIdx(next);
      if (next === options.length) inputRef.current?.focus();
      else if (inInput) inputRef.current?.blur();
    };
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) return cycle(1);
    if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) return cycle(-1);
    if ((e.key === "Enter" || e.key === " ") && !inInput) {
      e.preventDefault();
      if (kbIdx === options.length) inputRef.current?.focus();
      else if (kbIdx >= 0) void pick(options[kbIdx]!.label);
    }
  };

  return (
    <div className="question-card" onKeyDown={onCardKeyDown}>
      <div className="q-top">
        {q.header && <span className="q-badge">{q.header}</span>}
        <div className="q-text">{q.question}</div>
        {questions.length > 1 && (
          <span className="q-pager">
            <button className="q-pager-btn" data-tip={t("上一题")} aria-label={t("上一题")} disabled={submitting || page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              <ChevronLeft size={13} />
            </button>
            {page + 1}/{questions.length}
            <button className="q-pager-btn" data-tip={t("下一题")} aria-label={t("下一题")} disabled={submitting || isLast} onClick={() => setPage((p) => Math.min(questions.length - 1, p + 1))}>
              <ChevronRight size={13} />
            </button>
          </span>
        )}
        <button className="q-close" data-tip={t("取消提问")} disabled={submitting} onClick={() => void cancel()}>
          <X size={13} />
        </button>
      </div>
      {q.detail && <div className="q-detail">{q.detail}</div>}
      {options.length > 0 && (
        <div className="q-options">
          {options.map((o, i) => {
            const active = (draft?.selected ?? []).includes(o.label);
            return (
              <button
                key={o.label}
                className={`q-option${active ? " active" : ""}${kbIdx === i ? " kb" : ""}`}
                disabled={submitting}
                onClick={() => void pick(o.label)}
              >
                <span className="q-no">{i + 1}.</span>
                <span className="q-option-body">
                  <span className="q-option-label">{o.label}</span>
                  {o.description && <span className="q-option-desc">{o.description}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className={`q-custom${kbIdx === options.length ? " kb" : ""}`}>
        {options.length > 0 && <span className="q-no">{options.length + 1}.</span>}
        <input
          ref={inputRef}
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
        {/* 胶囊输入框内嵌的发送钮：回车的可见等价物，输入后才出现 */}
        {custom.trim() !== "" && (
          <button
            type="button"
            className="composer-send"
            data-tip={t("发送")}
            data-tip-keys="Enter"
            disabled={submitting}
            onClick={sendCustom}
          >
            <ArrowUp size={15} strokeWidth={2.4} />
          </button>
        )}
      </div>
      <div className="q-foot">
        <span className="q-hint">
          <Info size={13} />
          {t("使用 Tab / 上下键选择，回车或空格选中")}
        </span>
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
    </div>
  );
}

