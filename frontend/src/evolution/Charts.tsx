// 自进化的两张图（与使用统计同一套视觉语言：环图复用 chartMath 的弧路径，
// 柱状用同一条基线 + 同日粒度的轴）。数据来自 charts.ts 的纯函数。

import { arcPath } from "../stats/chartMath";
import { useT } from "../i18n";
import { activityMax, type ActivityDay, type Slice } from "./chartData";
import css from "./Evolution.module.css";

const SIZE = 168;
const R = 58;
const STROKE = 22;
/** 扇区间隙：约 2°，仅多扇区时收缩。 */
const GAP = (Math.PI * 2) / 180;

/** 状态语义色：青=有效、红=无效，其余走黑白灰（内容层例外色只用于语义）。 */
const SLICE_COLOR: Record<Slice["key"], string> = {
  effective: "var(--dsh-signal-live)",
  ineffective: "var(--dsh-signal-danger)",
  pending: "var(--ink)",
  applied: "var(--ink-2)",
  dismissed: "var(--ink-faint)",
  expired: "var(--ink-faintest)",
};

export function StatusDonut({ slices, total }: { slices: readonly Slice[]; total: number }) {
  const { t } = useT();
  const sum = slices.reduce((n, s) => n + s.value, 0);
  let start = -Math.PI / 2;
  const arcs = slices.map((s) => {
    const sweep = (s.value / sum) * Math.PI * 2;
    const arc = { ...s, start: start + GAP / 2, sweep: Math.max(sweep - GAP, 0.02) };
    start += sweep;
    return arc;
  });
  return (
    <div className={css.donut}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={t("经验构成")}>
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          {/* 空台账也画一圈底环：图表在没数据时也要读得出"这是个环" */}
          {sum === 0 && (
            <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--line)" strokeWidth={STROKE} />
          )}
          {arcs.map((a) => (
            <path key={a.key} d={arcPath(SIZE / 2, SIZE / 2, R, a.start, a.sweep)} fill="none"
              stroke={SLICE_COLOR[a.key]} strokeWidth={STROKE} strokeLinecap="butt" />
          ))}
        </g>
        <text x={SIZE / 2} y={SIZE / 2 - 2} textAnchor="middle" className={css.donutNum}>{sum}</text>
        <text x={SIZE / 2} y={SIZE / 2 + 16} textAnchor="middle" className={css.donutCap}>{t("条经验")}</text>
      </svg>
      <div className={css.legend}>
        {slices.map((s) => (
          <div key={s.key} className={css.legendRow}>
            <span className={css.legendDot} style={{ background: SLICE_COLOR[s.key] }} />
            <span className={css.legendLabel}>{t(s.label[0])}</span>
            <span className={css.legendValue}>{s.value}</span>
          </div>
        ))}
        {sum === 0 && <div className={css.legendEmpty}>{t("还没有经验")}</div>}
        {total > 0 && sum < total && <div className={css.legendEmpty}>{t("（其余未分类）")}</div>}
      </div>
    </div>
  );
}

export function ActivityBars({ days }: { days: readonly ActivityDay[] }) {
  const { t } = useT();
  const max = activityMax(days);
  const H = 96;
  const barW = 100 / days.length;
  return (
    <div className={css.bars}>
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" role="img" aria-label={t("近 30 天活动")} className={css.barsSvg}>
        {days.map((d, i) => {
          const total = d.created + d.runs;
          const h = (total / max) * (H - 8);
          return (
            <g key={d.key}>
              {d.created > 0 && (
                <rect x={i * barW + barW * 0.15} y={H - h} width={barW * 0.7} height={h} rx={0.6}
                  fill={d.runs > 0 ? "var(--ink-2)" : "var(--ink)"} />
              )}
              {d.runs > 0 && (
                <rect x={i * barW + barW * 0.15} y={H - (d.runs / max) * (H - 8)} width={barW * 0.7}
                  height={(d.runs / max) * (H - 8)} rx={0.6} fill="var(--ink-faint)" />
              )}
            </g>
          );
        })}
        <line x1="0" y1={H - 0.5} x2="100" y2={H - 0.5} stroke="var(--line)" strokeWidth="0.5" />
      </svg>
      <div className={css.barsFoot}>
        <span className={css.legendDot} style={{ background: "var(--ink)" }} />
        <span className={css.legendLabel}>{t("新增提案")}</span>
        <span className={css.legendDot} style={{ background: "var(--ink-faint)" }} />
        <span className={css.legendLabel}>{t("交办（落库/校验/复盘）")}</span>
        <span className={css.spacer} />
        <span className={css.legendLabel}>{t("近 30 天")}</span>
      </div>
    </div>
  );
}
