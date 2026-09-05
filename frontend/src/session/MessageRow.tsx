// 消息行呈现组件群（R-007 从 SessionView 搬出）：用户气泡、agent 文本、
// 消息元信息行（MessageMeta）、注入折叠行、压缩标记卡、状态点。
/// User message: down-scaled bubble (deliberately quiet, weak layer).

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { t, tt } from "../i18n";
import { Markdown } from "../components/Markdown";
import { TurnUsagePop } from "../components/UsageMeter";
import { IconBranchOutline16, IconCheckOutline16, IconCopyOutline16 } from "../components/Icons";
import { formatClock, formatLatencySeconds, formatRunDuration, formatTokensPerSecond } from "./format";
export function UserBubble({ text }: { text: string }) {
  return (
    <div className="user-bubble">{text}</div>
  );
}


/// Agent reply: pure text — NO bubble, NO element background (design rule).
export function AgentMessage({ text }: { text: string }) {
  return (
    <div className="agent-message">
      <Markdown text={text} />
    </div>
  );
}


/// Message foot row — copy [+ branch] + clock · [用时 · 首 token · tok/s].
/// Mirrors DSH MessageIconActions: user chrome = copy + clock("start");
/// assistant turn tail = copy + branch + clock("end") + usage stats.
/// Quiet by default: reveals on hover (DSH actions affordance).
export function MessageMeta({ time, runMs, ttftMs, tokensPerSecond, copiedText, clockSide = "end", branch = false, onBranch, usage }: {
  time?: number;
  runMs?: number;
  ttftMs?: number;
  tokensPerSecond?: number;
  copiedText: string;
  clockSide?: "start" | "end";
  branch?: boolean;
  onBranch?: () => void;
  usage?: import("../types").TokenUsage;
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


