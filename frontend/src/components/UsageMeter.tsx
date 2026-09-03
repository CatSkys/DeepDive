import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import type { TokenUsage } from "../types";

// 用量呈现（阶段 3.1）：ContextRing = 会话头部上下文占用环（点击弹层看
// 累计 token）；TurnUsagePop = 轮尾统计的用量弹层。数据均来自引擎投影
// 与 assistant usage 字段（docs/DSH-WIRE.md §3.2/§3.3），本组件只管画。

function fmtTokens(n: number | undefined): string {
  if (n === undefined || n === null) return "–";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

/** 上下文占用环：projected/contextWindow 的环形进度，盘面显示百分比。 */
export function ContextRing({ projected, window: win, usage }: {
  projected?: number;
  window?: number;
  usage?: { uncachedInputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (projected === undefined || !win) return null;
  const pct = Math.max(0, Math.min(1, projected / win));
  // 圆周 2πr（r=8）；stroke-dasharray 走"点亮弧长 空白弧长"二元
  const arc = 2 * Math.PI * 8;
  return (
    <div className="ctx-ring-wrap" ref={ref}>
      <button
        type="button"
        className="ctx-ring"
        title={t("上下文占用")}
        onClick={() => setOpen((v) => !v)}
        data-hot={pct > 0.85 ? "true" : "false"}
      >
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <circle cx="11" cy="11" r="8" fill="none" stroke="var(--line-strong)" strokeWidth="2.5" />
          <circle
            cx="11" cy="11" r="8" fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${arc * pct} ${arc}`}
            transform="rotate(-90 11 11)"
          />
        </svg>
        <span className="ctx-ring-pct">{Math.round(pct * 100)}%</span>
      </button>
      {open && (
        <div className="ctx-pop">
          <div className="ctx-pop-row"><span>{t("上下文")}</span><b>{fmtTokens(projected)} / {fmtTokens(win)}</b></div>
          <div className="ctx-pop-row"><span>{t("输入（未缓存）")}</span><b>{fmtTokens(usage?.uncachedInputTokens)}</b></div>
          <div className="ctx-pop-row"><span>{t("缓存读取")}</span><b>{fmtTokens(usage?.cacheReadTokens)}</b></div>
          <div className="ctx-pop-row"><span>{t("输出")}</span><b>{fmtTokens(usage?.outputTokens)}</b></div>
        </div>
      )}
    </div>
  );
}

/** 轮尾用量弹层：轮统计行作为锚点，点击展开本轮四项 token。 */
export function TurnUsagePop({ usage, children }: { usage?: TokenUsage; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!usage || !hasAnyToken(usage)) return <>{children}</>;
  return (
    <span className="turn-usage-wrap" ref={ref}>
      <span onClick={() => setOpen((v) => !v)} role="button" aria-expanded={open}>{children}</span>
      {open && (
        <div className="ctx-pop">
          <div className="ctx-pop-row"><span>{t("输入")}</span><b>{fmtTokens(usage.inputTokens)}</b></div>
          <div className="ctx-pop-row"><span>{t("缓存读取")}</span><b>{fmtTokens(usage.cacheReadTokens)}</b></div>
          <div className="ctx-pop-row"><span>{t("推理")}</span><b>{fmtTokens(usage.reasoningTokens)}</b></div>
          <div className="ctx-pop-row"><span>{t("输出")}</span><b>{fmtTokens(usage.outputTokens)}</b></div>
        </div>
      )}
    </span>
  );
}

function hasAnyToken(u: TokenUsage): boolean {
  return Object.values(u).some((v) => typeof v === "number");
}
