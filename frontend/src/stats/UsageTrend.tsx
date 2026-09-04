// 每日 Token 趋势图卡：时间范围（近 7/30 日）内按模型分线的平滑曲线。
// 悬浮显示当日总量与分模型明细；曲线/网格为 SVG，宽度随容器实测。
import { useEffect, useMemo, useRef, useState } from "react";
import { useT, type Lang } from "../i18n";
import { formatDayShort, formatTokensShort, type UsageDay } from "./usageStats";
import { smoothPath } from "./chartMath";
import { ChartTip, type ChartTipState } from "./ChartTip";
import css from "./UsageSection.module.css";

export interface LegendModel {
  name: string;
  color: string;
}

const H = 240;
const PAD = { top: 14, right: 12, bottom: 28, left: 12 };
const GRID_LINES = 4;

export function UsageTrend({ rangeDays, models, lang }: { rangeDays: UsageDay[]; models: LegendModel[]; lang: Lang }) {
  const { t, tt } = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [tip, setTip] = useState<ChartTipState | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0]!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 范围切换后旧 hover 落在别的日期上；指针不动不会触发 mouseleave，显式清掉
  useEffect(() => {
    setHover(null);
    setTip(null);
  }, [rangeDays]);

  const maxV = useMemo(() => Math.max(1, ...rangeDays.map((d) => d.tokens)), [rangeDays]);
  const hasData = rangeDays.some((d) => d.tokens > 0);
  const n = rangeDays.length;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => PAD.top + (1 - v / maxV) * plotH;

  const series = useMemo(
    () =>
      models.map((m) => ({
        ...m,
        d: smoothPath(rangeDays.map((day, i) => ({ x: x(i), y: y(day.byModel[m.name] ?? 0) }))),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [models, rangeDays, width, maxV],
  );

  if (!hasData) {
    return (
      <div className={css.card}>
        <div className={css.cardTitle}>{t("每日 Token 趋势图")}</div>
        <div className={css.chartEmpty}>{t("暂无数据")}</div>
      </div>
    );
  }

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const i = Math.round(((px - PAD.left) / Math.max(1, plotW)) * (n - 1));
    const idx = Math.min(n - 1, Math.max(0, i));
    setHover(idx);
    const day = rangeDays[idx]!;
    setTip({
      x: e.clientX,
      y: e.clientY,
      content: (
        <>
          <div className={css.tipTitle}>
            {tt("{d} · {s} tokens", "{d} · {s} tokens", { d: formatDayShort(day.day, lang), s: formatTokensShort(day.tokens, lang) })}
          </div>
          {models.map((m) => (
            <div key={m.name} className={css.tipRow}>
              <span className={css.dot} style={{ background: m.color }} />
              {m.name}
              <span className={css.tipMuted}>{formatTokensShort(day.byModel[m.name] ?? 0, lang)} tokens</span>
            </div>
          ))}
        </>
      ),
    });
  };

  // 日期轴：最多 ~7 个刻度，末位强制出
  const labelStep = n <= 8 ? 1 : Math.ceil(n / 7);

  return (
    <div className={css.card}>
      <div className={css.cardTitle} style={{ marginBottom: 8 }}>{t("每日 Token 趋势图")}</div>
      <div className={css.trendLegend}>
        {models.map((m) => (
          <span key={m.name} className={css.trendLegendItem}>
            <span className={css.dot} style={{ background: m.color }} />
            {m.name}
          </span>
        ))}
      </div>
      <div className={css.trendPlot} ref={wrapRef}>
        {width > 0 && (
          <svg className={css.trendSvg} width={width} height={H} onMouseLeave={() => { setTip(null); setHover(null); }}>
            {Array.from({ length: GRID_LINES }, (_, k) => {
              const gy = y((maxV * (k + 1)) / (GRID_LINES + 1));
              return (
                <line
                  key={k}
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={gy}
                  y2={gy}
                  stroke="var(--line)"
                  strokeDasharray="3 4"
                />
              );
            })}
            {rangeDays.map((day, i) =>
              i % labelStep === 0 || i === n - 1 ? (
                <text
                  key={day.day}
                  x={x(i)}
                  y={H - 8}
                  textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
                  fontSize={11}
                  fill="var(--ink-3)"
                >
                  {formatDayShort(day.day, lang)}
                </text>
              ) : null,
            )}
            {series.map((s) => (
              <path key={s.name} d={s.d} fill="none" stroke={s.color} strokeWidth={1.8} strokeLinecap="round" />
            ))}
            {hover !== null && (
              <>
                {series.map((s) => {
                  const day = rangeDays[hover]!;
                  return (
                    <circle key={s.name} cx={x(hover)} cy={y(day.byModel[s.name] ?? 0)} r={4} fill={s.color} />
                  );
                })}
              </>
            )}
            <rect
              x={0}
              y={0}
              width={width}
              height={H}
              fill="transparent"
              onMouseMove={onMove}
            />
          </svg>
        )}
      </div>
      <ChartTip tip={tip} />
    </div>
  );
}
