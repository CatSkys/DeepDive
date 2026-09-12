// 消息行呈现组件群（R-007 从 SessionView 搬出）：用户气泡、agent 文本、
// 消息元信息行（MessageMeta）、消息反馈（FeedbackRating）、注入折叠行、
// 压缩标记卡、状态点。
/// User message: down-scaled bubble (deliberately quiet, weak layer).

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { t, tt } from "../i18n";
import { Markdown } from "../components/Markdown";
import { TurnUsagePop } from "../components/UsageMeter";
import { IconBranchOutline16, IconCheckOutline16, IconCopyOutline16, IconDislikeFill16, IconDislikeOutline16, IconLikeFill16, IconLikeOutline16 } from "../components/Icons";
import { formatClock, formatLatencySeconds, formatRunDuration, formatTokensPerSecond } from "./format";
import type { useFeedback } from "./feedback";
export function UserBubble({ text }: { text: string }) {
  return (
    <div className="user-bubble">{text}</div>
  );
}


/// Agent reply: pure text — NO bubble, NO element background (design rule).
export function AgentMessage({ text, onOpenFile }: {
  text: string;
  /** 正文里本地文件链接（`src/app.ts:42`）的落点：交预览打开并落到该行。 */
  onOpenFile?: (path: string, line?: number) => void;
}) {
  return (
    <div className="agent-message">
      <Markdown text={text} onOpenFile={onOpenFile} />
    </div>
  );
}


/// Message foot row — copy [+ branch] + clock · [用时 · 首 token · tok/s].
/// Mirrors DSH MessageIconActions: user chrome = copy + clock("start");
/// assistant turn tail = copy + branch + clock("end") + usage stats.
/// Quiet by default: reveals on hover (DSH actions affordance).
export function MessageMeta({ time, runMs, ttftMs, tokensPerSecond, copiedText, clockSide = "end", branch = false, onBranch, usage, feedback }: {
  time?: number;
  runMs?: number;
  ttftMs?: number;
  tokensPerSecond?: number;
  copiedText: string;
  clockSide?: "start" | "end";
  branch?: boolean;
  onBranch?: () => void;
  usage?: import("../types").TokenUsage;
  /** assistant 轮尾的消息反馈（messageId + 控制器）；官方位置=copy 与 branch 之间。 */
  feedback?: { messageId: string; ctrl: ReturnType<typeof useFeedback> };
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copiedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch { /* 剪贴板不可用（权限/焦点缺失）：跳过已复制反馈 */ }
  };
  const hasStats = runMs !== undefined || ttftMs !== undefined || tokensPerSecond !== undefined;
  const clock = time ? formatClock(time) : undefined;
  if (!clock && !hasStats && !branch) return null;
  const clockEl = (
    <TurnUsagePop usage={usage}>
      <span className="meta-clock">
        {clock}
        {runMs !== undefined && (
          <>
            <span className="meta-dot" aria-hidden="true">·</span>
            {t("用时")} {formatRunDuration(runMs)}
          </>
        )}
        {ttftMs !== undefined && (
          <>
            <span className="meta-dot" aria-hidden="true">·</span>
            {t("首 token")} {formatLatencySeconds(ttftMs)}
          </>
        )}
        {tokensPerSecond !== undefined && (
          <>
            <span className="meta-dot" aria-hidden="true">·</span>
            {formatTokensPerSecond(tokensPerSecond)} tok/s
          </>
        )}
      </span>
    </TurnUsagePop>
  );
  return (
    <div className="meta-actions">
      {clockSide === "start" ? clockEl : null}
      <button className="meta-action" data-tip={copied ? t("复制成功") : t("复制")} aria-label={copied ? t("复制成功") : t("复制")} onClick={() => void copy()}>
        {copied ? <IconCheckOutline16 size={16} /> : <IconCopyOutline16 size={16} />}
      </button>
      {feedback && <FeedbackRating messageId={feedback.messageId} ctrl={feedback.ctrl} />}
      {branch && (
        <button
          className="meta-action"
          data-tip={t("分支")}
          aria-label={t("分支")}
          onClick={onBranch}
        >
          <IconBranchOutline16 size={16} />
        </button>
      )}
      {clockSide === "end" ? clockEl : null}
    </div>
  );
}



/// 单条消息的反馈控件（官方 MessageFeedbackActions 移植）：👍/👎 双钮 +
/// 备注（有反馈才显触发器；编辑器为 body 门户弹层——行内放不下输入区，
/// 且转出会话列才能逃离 overflow 裁切）。同评再点=撤销；冷视图首次
/// hover/focus 才拉 list（每条消息都挂控件，不能每条都拉）。
export function FeedbackRating({ messageId, ctrl }: {
  messageId: string;
  ctrl: ReturnType<typeof useFeedback>;
}) {
  const item = ctrl.view.items.get(messageId);
  const rating = item?.rating;
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [noteFailure, setNoteFailure] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  /** 编辑会话代号：关闭弹层即作废旧会话的迟到保存（官方 generation 语义）。 */
  const generation = useRef(0);

  const seeded = useRef(false);
  const seed = () => {
    if (seeded.current) return;
    seeded.current = true;
    ctrl.ensure();
  };

  const errorCopy = (r: { ok: boolean; code?: string }) =>
    r.ok ? null : r.code === "version-conflict" ? t("反馈已被其他位置修改，已同步最新状态") : t("反馈操作失败");

  const onRate = (next: "positive" | "negative") => {
    setPending(true);
    setFailure(null);
    generation.current += 1;
    setNoteOpen(false);
    void ctrl.toggle(messageId, next).then((r) => {
      setPending(false);
      setFailure(errorCopy(r));
    });
  };

  const toggleNote = () => {
    if (noteOpen) {
      generation.current += 1;
      setNoteOpen(false);
      return;
    }
    setDraft(item?.note ?? "");
    setNoteFailure(null);
    setNoteOpen(true);
  };

  const saveNote = (current: "positive" | "negative") => {
    const trimmed = draft.trim();
    const gen = generation.current;
    setPending(true);
    setNoteFailure(null);
    // 空存=显式清备注（rate 的 note 省略=保留存储值，表达不了删除）
    const settled = trimmed.length === 0 ? ctrl.clearNote(messageId) : ctrl.rate(messageId, current, trimmed);
    void settled.then((r) => {
      setPending(false);
      if (r.ok) {
        if (gen === generation.current) {
          setNoteFailure(null);
          setNoteOpen(false);
        }
        return;
      }
      if (gen === generation.current || !noteOpen) setNoteFailure(errorCopy(r));
    });
  };

  // 弹层交互：聚焦输入、外点/Esc 关闭（关闭都作废在途保存会话）
  useEffect(() => {
    if (!noteOpen) return;
    textRef.current?.focus();
    const close = () => {
      generation.current += 1;
      setNoteOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return;
      if (triggerRef.current?.contains(e.target) === true) return;
      if (panelRef.current?.contains(e.target) === true) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [noteOpen]);

  // 弹层随锚定（滚动/缩放跟随；视口边距 12px）
  const [panelPos, setPanelPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!noteOpen) return;
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const PANEL_W = 280;
      const left = Math.min(Math.max(12, r.left), window.innerWidth - PANEL_W - 12);
      setPanelPos({ left, top: r.bottom + 4 });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [noteOpen]);

  const likeLabel = rating === "positive" ? t("已点赞") : t("点赞");
  const dislikeLabel = rating === "negative" ? t("已踩") : t("点踩");
  return (
    <>
      <button
        className="meta-action feedback-action"
        data-active={rating === "positive" || undefined}
        data-tip={likeLabel}
        aria-label={likeLabel}
        aria-pressed={rating === "positive"}
        disabled={pending}
        onPointerEnter={seed}
        onFocus={seed}
        onClick={() => onRate("positive")}
      >
        {rating === "positive" ? <IconLikeFill16 size={16} /> : <IconLikeOutline16 size={16} />}
      </button>
      <button
        className="meta-action feedback-action"
        data-active={rating === "negative" || undefined}
        data-tip={dislikeLabel}
        aria-label={dislikeLabel}
        aria-pressed={rating === "negative"}
        disabled={pending}
        onPointerEnter={seed}
        onFocus={seed}
        onClick={() => onRate("negative")}
      >
        {rating === "negative" ? <IconDislikeFill16 size={16} /> : <IconDislikeOutline16 size={16} />}
      </button>
      {rating !== undefined && (
        <button ref={triggerRef} type="button" className="feedback-note-trigger" onClick={toggleNote} aria-haspopup="dialog" aria-expanded={noteOpen}>
          {item?.note === undefined ? t("备注") : item.note}
        </button>
      )}
      {failure !== null && <span className="feedback-failure" role="status">{failure}</span>}
      {failure === null && ctrl.view.status === "error" && <span className="feedback-failure" role="status">{t("反馈读取失败")}</span>}
      {noteOpen && createPortal(
        <div ref={panelRef} className="feedback-note-panel" role="dialog" aria-label={t("备注")}
          style={panelPos ?? { visibility: "hidden", left: 0, top: 0 }}>
          <textarea
            ref={textRef}
            className="feedback-note-input"
            aria-label={t("备注")}
            placeholder={t("补充说明…")}
            value={draft}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="feedback-note-actions">
            <button type="button" className="btn-primary" disabled={pending} onClick={() => saveNote(rating!)}>{t("保存")}</button>
            <button type="button" className="btn-plain" onClick={toggleNote}>{t("取消")}</button>
          </div>
          {noteFailure !== null && <span className="feedback-failure" role="status">{noteFailure}</span>}
        </div>,
        document.body,
      )}
    </>
  );
}



/** 压缩标记卡（3.4）：compaction/summary 的流内标记，展开看压缩摘要。 */
export function CompactionCard({ summary, shadowedTokens }: { summary: string; shadowedTokens?: string }) {
  const [open, setOpen] = useState(false);
  const n = shadowedTokens ? Number(shadowedTokens) : NaN;
  return (
    <div className="compaction-card" data-open={open ? "true" : "false"}>
      <button type="button" className="compaction-main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="compaction-ic" aria-hidden="true">⤺</span>
        <span>
          {t("已压缩更早的上下文")}
          {Number.isFinite(n) ? tt("（约 {n} tokens）", " (~{n} tokens)", { n }) : ""}
        </span>
        <ChevronDown size={12} className="injection-chev" />
      </button>
      {open && summary && (
        <div className="compaction-body">
          <Markdown text={summary} />
        </div>
      )}
    </div>
  );
}


export function StateDot({ state }: { state: "running" | "error" | "warning" | "ok" }) {
  return <span className={`state-dot ${state}`} aria-hidden="true" />;
}


