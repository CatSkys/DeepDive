// 消息行呈现组件群（R-007 从 SessionView 搬出）：用户气泡、agent 文本、
// 消息元信息行（MessageMeta）、注入折叠行、
// 压缩标记卡、状态点。
/// User message: down-scaled bubble (deliberately quiet, weak layer).

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { t, tt } from "../i18n";
import { Markdown } from "../components/Markdown";
import { IconBranchOutline16, IconCheckOutline16, IconCopyOutline16 } from "../components/Icons";
import { formatClock } from "./format";
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


// 轮尾动作行（用户定稿）：只保留 复制 / 分支 / 时间 三件——点赞点踩（消息反馈）
// 与用时/首 token/tok 速度一并移除。hover 才显现（DSH actions affordance）。
export function MessageMeta({ time, copiedText, clockSide = "end", branch = false, onBranch }: {
  time?: number;
  copiedText: string;
  clockSide?: "start" | "end";
  branch?: boolean;
  onBranch?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copiedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch { /* 剪贴板不可用（权限/焦点缺失）：跳过已复制反馈 */ }
  };
  const clock = time ? formatClock(time) : undefined;
  if (!clock && !branch) return null;
  const clockEl = <span className="meta-clock">{clock}</span>;
  return (
    <div className="meta-actions">
      {clockSide === "start" ? clockEl : null}
      <button className="meta-action" data-tip={copied ? t("复制成功") : t("复制")} aria-label={copied ? t("复制成功") : t("复制")} onClick={() => void copy()}>
        {copied ? <IconCheckOutline16 size={16} /> : <IconCopyOutline16 size={16} />}
      </button>
      {branch && (
        <button className="meta-action" data-tip={t("分支")} aria-label={t("分支")} onClick={onBranch}>
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


