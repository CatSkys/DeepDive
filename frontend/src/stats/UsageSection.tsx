// 设置 → 使用统计：用量自本机会话历史折叠（usageStats.ts，引擎无 usage RPC）。
// 四卡片：摘要 / Token 活动热力图 / 每日趋势 / 模型用量；时间范围作用于
// 趋势图与模型用量两卡，摘要与热力图恒为全量。载入后自动算一次，页脚可刷新。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import rowsCss from "../settings/SettingsRows.module.css";
import { useT } from "../i18n";
import {
  collectUsageStats, formatDays, formatDuration, formatTokensShort,
  lastNDayKeys, modelOrderOf, type UsageDay, type UsageStats,
} from "./usageStats";
import { UsageHeatmap } from "./UsageHeatmap";
import { UsageTrend, type LegendModel } from "./UsageTrend";
import { UsageDonut } from "./UsageDonut";
import css from "./UsageSection.module.css";

type UsageRange = 7 | 30;

/** 数据系列配色（tokens.json chart 组）：模型按总量降序轮转取色。 */
const SERIES_COLORS = [
  "var(--dsh-chart-series1)",
  "var(--dsh-chart-series2)",
  "var(--dsh-chart-series3)",
  "var(--dsh-chart-series4)",
  "var(--dsh-chart-series5)",
];

const EMPTY_DAY = (day: string): UsageDay => ({ day, tokens: 0, turns: 0, byModel: {} });

export function UsageSection() {
  const { t, tt, lang } = useT();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [range, setRange] = useState<UsageRange>(7);
  const [busy, setBusy] = useState(false);
  const runRef = useRef(0);

  const load = useCallback(async () => {
    const run = ++runRef.current;
    setBusy(true);
    try {
      const s = await collectUsageStats();
      if (runRef.current !== run) return;
      setStats(s);
      setPhase("ready");
    } catch (err) {
      if (runRef.current !== run) return;
      setErrMsg((err as Error).message);
      setPhase("error");
    } finally {
      if (runRef.current === run) setBusy(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const models: LegendModel[] = useMemo(
    () => (stats ? modelOrderOf(stats).map((name, i) => ({ name, color: SERIES_COLORS[i % SERIES_COLORS.length]! })) : []),
    [stats],
  );
  // 时间范围切片：无数据日补零，键以载入时刻为准
  const rangeDays = useMemo(() => {
    if (!stats) return [];
    const map = new Map(stats.days.map((d) => [d.day, d]));
    return lastNDayKeys(range, Date.now()).map((k) => map.get(k) ?? EMPTY_DAY(k));
  }, [stats, range]);

  if (phase !== "ready" && !stats) {
    return (
      <div>
        <div className={rowsCss.muted}>
          {phase === "loading" ? t("载入中…") : tt("读取失败：{m}", "Read failed: {m}", { m: errMsg })}
        </div>
        <div className={css.sectionFoot}>
          <button className={rowsCss.secondaryButton} onClick={() => void load()}>
            <RefreshCw size={13} className={busy ? rowsCss.spin : undefined} />
            {t("刷新")}
          </button>
        </div>
      </div>
    );
  }

  const metrics: Array<{ value: string; label: string }> = stats
    ? [
      { value: formatTokensShort(stats.totalTokens, lang), label: t("累计 Token 数") },
      { value: formatTokensShort(stats.peakDayTokens, lang), label: t("峰值 Token 数") },
      { value: formatDuration(stats.longestChatMs, lang), label: t("最长聊天时长") },
      { value: formatDays(stats.currentStreak, lang), label: t("当前连续天数") },
      { value: formatDays(stats.longestStreak, lang), label: t("最长连续天数") },
    ]
    : [];

  return (
    <div>
      <div className={css.card}>
        <div className={css.summary}>
          {metrics.map((m) => (
            <div key={m.label} className={css.summaryCell}>
              <div className={css.summaryValue}>{m.value}</div>
              <div className={css.summaryLabel}>{m.label}</div>
            </div>
          ))}
        </div>
      </div>
      {stats && <UsageHeatmap days={stats.days} />}
      <div className={css.rangeRow}>
        <div className={css.rangeLabel}>{t("时间范围")}</div>
        <div className={css.seg}>
          {([7, 30] as const).map((r) => (
            <button
              key={r}
              className={`${css.segItem}${range === r ? ` ${css.active}` : ""}`}
              onClick={() => setRange(r)}
            >
              {t(r === 7 ? "近 7 日" : "近 30 日")}
            </button>
          ))}
        </div>
      </div>
      <UsageTrend rangeDays={rangeDays} models={models} lang={lang} />
      <UsageDonut rangeDays={rangeDays} models={models} lang={lang} />
      {/* 刷新失败但旧数据仍在：非阻断提示，避免用户误以为刷新成功 */}
      {phase === "error" && <div className={rowsCss.modelError}>{tt("读取失败：{m}", "Read failed: {m}", { m: errMsg })}</div>}
      <div className={css.sectionFoot}>
        <button className={rowsCss.secondaryButton} onClick={() => void load()}>
          <RefreshCw size={13} className={busy ? rowsCss.spin : undefined} />
          {t("刷新")}
        </button>
      </div>
    </div>
  );
}
