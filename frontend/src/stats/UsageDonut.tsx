// 模型用量圆环卡：时间范围内的分模型 tokens 占比。悬浮扇区加粗并显示
// 明细（模型 / tokens / 百分比）；单一模型时画整圆。弧路径走 chartMath。
import { useMemo, useState } from "react";
import { useT, type Lang } from "../i18n";
import { formatTokensShort, type UsageDay } from "./usageStats";
import { arcPath } from "./chartMath";
import { ChartTip, type ChartTipState } from "./ChartTip";
import css from "./UsageSection.module.css";
import type { LegendModel } from "./UsageTrend";

const SIZE = 200;
const R = 70;
const STROKE = 26;
/** 扇区间隙（弧度）：约 2°，仅多扇区时收缩。 */
const GAP = (Math.PI * 2) / 180;

export function UsageDonut({ rangeDays, models, lang }: { rangeDays: UsageDay[]; models: LegendModel[]; lang: Lang }) {
  const { t, tt } = useT();
  const [tip, setTip] = useState<ChartTipState | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const slices = useMemo(() => {
    const totals = models.map((m) => ({
      ...m,
      tokens: rangeDays.reduce((s, d) => s + (d.byModel[m.name] ?? 0), 0),
    }));
    const total = totals.reduce((s, x) => s + x.tokens, 0);
    let start = -Math.PI / 2;
    const arcs = totals
      .filter((x) => x.tokens > 0)
      .map((x) => {
        const sweep = (x.tokens / total) * Math.PI * 2;
        const arc = { ...x, frac: x.tokens / total, start: start + GAP / 2, sweep: Math.max(sweep - GAP, 0.02) };
        start += sweep;
        return arc;
      });
    return { arcs, total };
  }, [models, rangeDays]);

  if (slices.arcs.length === 0) {
    return (
      <div className={css.card}>
        <div className={css.cardTitle}>{t("模型用量")}</div>
        <div className={css.chartEmpty}>{t("暂无数据")}</div>
      </div>
    );
  }

  const cx = SIZE / 2;
  const showTip = (e: React.MouseEvent, arc: (typeof slices.arcs)[number], idx: number) => {
    setHover(idx);
    setTip({
      x: e.clientX,
      y: e.clientY,
      content: (
        <>
          <div className={css.tipRow} style={{ marginTop: 0 }}>
            <span className={css.dot} style={{ background: arc.color }} />
            <span className={css.tipTitle}>{arc.name}</span>
          </div>
          <div className={css.tipRow}>
            <span>{tt("{s} tokens", "{s} tokens", { s: formatTokensShort(arc.tokens, lang) })}</span>
            <span className={css.tipMuted}>{Math.round(arc.frac * 100)}%</span>
          </div>
        </>
      ),
    });
  };

  return (
    <div className={css.card}>
      <div className={css.cardTitle} style={{ marginBottom: 8 }}>{t("模型用量")}</div>
      <div className={css.donutBody}>
        <div className={css.donutPlot} onMouseLeave={() => { setTip(null); setHover(null); }}>
          <svg width={SIZE} height={SIZE}>
            {slices.arcs.length === 1 ? (
              <circle
                cx={cx}
                cy={cx}
                r={R}
                fill="none"
                stroke={slices.arcs[0]!.color}
                strokeWidth={hover === 0 ? STROKE + 3 : STROKE}
                onMouseMove={(e) => showTip(e, slices.arcs[0]!, 0)}
              />
            ) : (
              slices.arcs.map((arc, i) => (
                <path
                  key={arc.name}
                  d={arcPath(cx, cx, R, arc.start, arc.sweep)}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={hover === i ? STROKE + 3 : STROKE}
                  onMouseMove={(e) => showTip(e, arc, i)}
                />
              ))
            )}
          </svg>
          <div className={css.donutCenter}>
            <div className={css.donutCenterValue}>{formatTokensShort(slices.total, lang)}</div>
            <div className={css.donutCenterUnit}>tokens</div>
          </div>
        </div>
        <div className={css.donutLegend}>
          {slices.arcs.map((arc, i) => (
            <div key={arc.name} className={css.legendRow} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <span className={css.dot} style={{ background: arc.color }} />
              <div className={css.legendMain}>
                <div className={css.legendName}>{arc.name}</div>
                <div className={css.legendTokens}>{formatTokensShort(arc.tokens, lang)} tokens</div>
              </div>
              <div className={css.legendPct}>{Math.round(arc.frac * 100)}%</div>
            </div>
          ))}
        </div>
      </div>
      <ChartTip tip={tip} />
    </div>
  );
}
