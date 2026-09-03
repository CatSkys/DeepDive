import { useEffect, useRef, useState } from "react";
import { t, tt } from "../i18n";
import type { TokenUsage } from "../types";

// 用量呈现（阶段 3.1）：ContextRing = 输入框内的上下文容量圈（hover 弹层看
// 容量/组成/缓存命中）；TurnUsagePop = 轮尾统计的用量弹层。数据均来自引擎
// 投影与 assistant usage 字段（docs/DSH-WIRE.md §3.2/§3.3），本组件只管画。

export interface ContextData {
  projected?: number;
  window?: number;
  usage?: { uncachedInputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
  breakdown?: { systemTokens?: number; toolsTokens?: number; messageTokens?: number };
}

function fmtTokens(n: number | undefined): string {
  if (n === undefined || n === null) return "–";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/** 渲染门槛：projected/contextWindow 缺任一则无容量可画（Composer 据此不占网格位）。 */
export function hasContextData(ctx?: ContextData): ctx is ContextData & { projected: number; window: number } {
  return !!ctx && ctx.projected !== undefined && !!ctx.window;
}

/** 上下文容量圈：projected/contextWindow 的环形进度，盘面显示百分比；
 *  hover 弹出容量面板（总量+进度条、三类组成占比、平均缓存命中率）。 */
export function ContextRing({ ctx }: { ctx?: ContextData }) {
  const [open, setOpen] = useState(false);
  // 离圈到弹层之间有缝，延时关闭让指针安全走过；再次进入即取消
  const closeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  const hover = (v: boolean) => {
    window.clearTimeout(closeTimer.current);
    if (v) setOpen(true);
    else closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };
  if (!hasContextData(ctx)) return null;
  const { projected, window: win } = ctx;
  const pct = Math.max(0, Math.min(1, projected / win));
  const hot = pct > 0.85;
  // 组成三行：引擎 contextBreakdown 是启发式估算，按引擎要求只呈现三类
  // 占比（分母=三类之和），不合进 projectedTokens 总计（DSH-WIRE §3.3）
  const parts = [
    { label: t("消息"), tokens: ctx.breakdown?.messageTokens },
    { label: t("工具"), tokens: ctx.breakdown?.toolsTokens },
    { label: t("系统提示词"), tokens: ctx.breakdown?.systemTokens },
  ].filter((p): p is { label: string; tokens: number } => typeof p.tokens === "number");
  const sum = parts.reduce((acc, p) => acc + p.tokens, 0);
  // 平均缓存命中率 = 缓存读取 / 全部输入侧（未缓存+读+写；tokenUsage 四桶互斥）
  const inputSide = (ctx.usage?.uncachedInputTokens ?? 0) + (ctx.usage?.cacheReadTokens ?? 0) + (ctx.usage?.cacheWriteTokens ?? 0);
  const hit = inputSide > 0 ? (ctx.usage?.cacheReadTokens ?? 0) / inputSide : undefined;
  // 圆周 2πr（r=8）；stroke-dasharray 走"点亮弧长 空白弧长"二元
  const arc = 2 * Math.PI * 8;
  return (
    <div className="ctx-ring-wrap" onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
      <div className="ctx-ring" data-hot={hot ? "true" : "false"} aria-label={`${t("上下文容量")} ${Math.round(pct * 100)}%`}>
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
      </div>
      {open && (
        <div className="ctx-pop ctx-cap">
          <div className="ctx-cap-head">
            <span className="ctx-cap-title">{t("上下文容量")}</span>
            <span className="ctx-cap-total">{tt("{a} / {b}（{p}）", "{a} / {b} ({p})", { a: fmtTokens(projected), b: fmtTokens(win), p: fmtPct(pct) })}</span>
          </div>
          <div className="ctx-cap-bar"><span style={{ width: `${pct * 100}%` }} data-hot={hot ? "true" : "false"} /></div>
          {sum > 0 && parts.map((p, i) => (
            <div key={p.label} className="ctx-cap-row">
              <span className="ctx-cap-dot" style={{ opacity: 1 - i * 0.35 }} />
              {p.label}
              <b>{fmtPct(p.tokens / sum)}</b>
            </div>
          ))}
          {hit !== undefined && (
            <>
              <div className="ctx-cap-div" />
              <div className="ctx-cap-row"><span>{t("平均缓存命中率")}</span><b>{fmtPct(hit)}</b></div>
            </>
          )}
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
