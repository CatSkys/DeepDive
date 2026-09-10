// 会话统计两摘要（官方 StatsPills 的单屏移植）：速度摘要（轮/步/解码速度）
// 与用量摘要（总 token/缓存命中），点击展开明细。数据来自会话投影
// sessionStats + tokenUsage（快照种子 + control projection 帧/轮询刷新）。

import { useState } from "react";
import { ChevronDown, Database, Gauge } from "lucide-react";
import { t, tt } from "../i18n";

interface SessionStats {
  turns?: number;
  steps?: number;
  llmMs?: number;
  toolMs?: number;
  ttftMs?: number;
  ttftSteps?: number;
  decodeMs?: number;
  decodeTokens?: number;
}

interface TokenUsage {
  uncachedInputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

const fmtMs = (ms?: number) => (ms === undefined ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
const fmtTokens = (n?: number) => (n === undefined ? "—" : n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function StatsPills({ stats, usage }: { stats?: SessionStats; usage?: TokenUsage }) {
  const [open, setOpen] = useState<"time" | "usage" | null>(null);
  if (!stats && !usage) return null;

  const decodeSpeed = stats?.decodeMs && stats.decodeMs > 0 && stats.decodeTokens
    ? Math.round(stats.decodeTokens / (stats.decodeMs / 1000))
    : undefined;
  const billedInput = (usage?.uncachedInputTokens ?? 0) + (usage?.cacheReadTokens ?? 0);
  const cacheHit = billedInput > 0 && usage?.cacheReadTokens !== undefined
    ? Math.round(((usage.cacheReadTokens ?? 0) / billedInput) * 100)
    : undefined;
  const totalTokens = billedInput + (usage?.outputTokens ?? 0);

  return (
    <div className="stats-pills">
      <button
        type="button"
        className="stats-pill"
        data-tip={t("会话速度明细")}
        aria-expanded={open === "time"}
        onClick={() => setOpen(open === "time" ? null : "time")}
      >
        <Gauge size={12} />
        <span>
          {stats?.turns !== undefined ? tt("{n} 轮", "{n} turns", { n: stats.turns }) : "—"}
          {decodeSpeed !== undefined ? ` · ${tt("{n} tok/s", "{n} tok/s", { n: decodeSpeed })}` : ""}
        </span>
        <ChevronDown size={11} />
      </button>
      <button
        type="button"
        className="stats-pill"
        data-tip={t("Token 用量明细")}
        aria-expanded={open === "usage"}
        onClick={() => setOpen(open === "usage" ? null : "usage")}
      >
        <Database size={12} />
        <span>
          {fmtTokens(totalTokens)}
          {cacheHit !== undefined ? ` · ${tt("缓存 {n}%", "{n}% cached", { n: cacheHit })}` : ""}
        </span>
        <ChevronDown size={11} />
      </button>
      {open === "time" && (
        <div className="stats-pop" role="dialog" aria-label={t("会话速度明细")}>
          <div>{t("模型耗时")}: {fmtMs(stats?.llmMs)}</div>
          <div>{t("工具耗时")}: {fmtMs(stats?.toolMs)}</div>
          <div>{t("平均首 token")}: {stats?.ttftSteps ? fmtMs(Math.round(stats.ttftMs! / stats.ttftSteps)) : "—"}</div>
          <div>{t("解码速度")}: {decodeSpeed !== undefined ? tt("{n} tok/s", "{n} tok/s", { n: decodeSpeed }) : "—"}</div>
        </div>
      )}
      {open === "usage" && (
        <div className="stats-pop" role="dialog" aria-label={t("Token 用量明细")}>
          <div>{t("缓存命中")}: {cacheHit !== undefined ? `${cacheHit}%` : "—"}</div>
          <div>{t("未缓存输入")}: {fmtTokens(usage?.uncachedInputTokens)}</div>
          <div>{t("缓存读取")}: {fmtTokens(usage?.cacheReadTokens)}</div>
          {usage?.cacheWriteTokens ? <div>{t("缓存写入")}: {fmtTokens(usage.cacheWriteTokens)}</div> : null}
          <div>{t("输出")}: {fmtTokens(usage?.outputTokens)}</div>
          <div>{t("合计")}: {fmtTokens(totalTokens)}</div>
        </div>
      )}
    </div>
  );
}
