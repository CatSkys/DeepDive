// `ui` 围栏的图表组件：手绘 SVG（无第三方图表库）。三型——bar / line / pie，
// 色板取 design tokens 的 chart series；坐标、半径这些是绘图常量不是主题数值
// （与 tokens 管线无关，改动不需要过 make tokens）。数据形状已由词表校验保证。
import type { UiChart } from "./types";

const W = 320;
const H = 180;
const PAD_T = 12;
const PAD_B = 22;
const PLOT_W = W - 16;
const PLOT_H = H - PAD_T - PAD_B;

/** 第 i 条系列的颜色（series1..5 循环）。 */
const color = (i: number) => `var(--dsh-chart-series${(i % 5) + 1})`;

const xAt = (index: number, count: number) => 8 + (index + 0.5) * (PLOT_W / count);
const yAt = (value: number, max: number) => PAD_T + PLOT_H - (Math.max(0, value) / max) * PLOT_H;

function SeriesLegend({ item }: { item: UiChart }) {
  if (!item.series.some((s) => s.name !== undefined)) return null;
  return (
    <div className="md-ui-legend">
      {item.series.map((s, i) => (
        <span key={i} className="md-ui-legend-item">
          <span className="md-ui-legend-dot" style={{ background: color(i) }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

function PieLegend({ item }: { item: UiChart }) {
  const values = item.series[0]!.values;
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return null;
  return (
    <div className="md-ui-legend">
      {item.labels.map((label, i) => (
        <span key={i} className="md-ui-legend-item">
          <span className="md-ui-legend-dot" style={{ background: color(i) }} />
          {`${label} ${Math.round((Math.max(0, values[i] ?? 0) / total) * 100)}%`}
        </span>
      ))}
    </div>
  );
}

function BarPlot({ item }: { item: UiChart }) {
  const max = Math.max(...item.series.flatMap((s) => s.values), 0) || 1;
  const groupW = PLOT_W / item.labels.length;
  const barW = Math.max(1, (groupW * 0.72) / item.series.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="md-ui-chart-svg" role="img">
      <line x1={8} y1={PAD_T + PLOT_H} x2={W - 8} y2={PAD_T + PLOT_H} stroke="var(--line-strong)" strokeWidth="1" />
      {item.labels.map((_, li) => item.series.map((s, si) => {
        const v = s.values[li] ?? 0;
        const h = (Math.max(0, v) / max) * PLOT_H;
        return (
          <rect
            key={`${li}-${si}`}
            x={8 + li * groupW + si * barW}
            y={PAD_T + PLOT_H - h}
            width={barW}
            height={h}
            fill={color(si)}
          />
        );
      }))}
      {item.labels.map((label, li) => (
        <text key={li} x={xAt(li, item.labels.length)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--ink-3)">
          {label.slice(0, 8)}
        </text>
      ))}
    </svg>
  );
}

function LinePlot({ item }: { item: UiChart }) {
  const max = Math.max(...item.series.flatMap((s) => s.values), 0) || 1;
  const points = (values: number[]) =>
    values.map((v, i) => `${xAt(i, values.length)},${yAt(v, max)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="md-ui-chart-svg" role="img">
      <line x1={8} y1={PAD_T + PLOT_H} x2={W - 8} y2={PAD_T + PLOT_H} stroke="var(--line-strong)" strokeWidth="1" />
      {item.series.map((s, si) => (
        <g key={si}>
          <polyline points={points(s.values)} fill="none" stroke={color(si)} strokeWidth="2" />
          {s.values.map((v, vi) => (
            <circle key={vi} cx={xAt(vi, s.values.length)} cy={yAt(v, max)} r="2.5" fill={color(si)} />
          ))}
        </g>
      ))}
      {item.labels.map((label, li) => (
        <text key={li} x={xAt(li, item.labels.length)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--ink-3)">
          {label.slice(0, 8)}
        </text>
      ))}
    </svg>
  );
}

/** 扇形 arc 路径（从 12 点方向顺时针）。单系列；total=0 时由调用方画整圆。 */
function slicePath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const x0 = cx + r * Math.sin(a0);
  const y0 = cy - r * Math.cos(a0);
  const x1 = cx + r * Math.sin(a1);
  const y1 = cy - r * Math.cos(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
}

function PiePlot({ item }: { item: UiChart }) {
  const values = item.series[0]!.values;
  const total = values.reduce((a, b) => a + Math.max(0, b), 0);
  const cx = H / 2;
  const cy = H / 2;
  const r = 62;
  if (total <= 0) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="md-ui-chart-svg" role="img">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--line-strong)" strokeDasharray="3 3" />
      </svg>
    );
  }
  const nonzero = values.map((v, i) => ({ v, i })).filter((e) => e.v > 0);
  // 100% 单切片：arc 会退化成零长路径，整圆直出
  if (nonzero.length === 1) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="md-ui-chart-svg" role="img">
        <circle cx={cx} cy={cy} r={r} fill={color(nonzero[0]!.i)} />
      </svg>
    );
  }
  let angle = 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="md-ui-chart-svg" role="img">
      {nonzero.map(({ v, i }) => {
        const sweep = (v / total) * Math.PI * 2;
        const path = slicePath(cx, cy, r, angle, angle + sweep);
        angle += sweep;
        return <path key={i} d={path} fill={color(i)} />;
      })}
    </svg>
  );
}

export function ChartView({ item }: { item: UiChart }) {
  return (
    <div className="md-ui-chart">
      {item.title && <div className="md-ui-card-title">{item.title}</div>}
      {item.chart === "bar" && <><BarPlot item={item} /><SeriesLegend item={item} /></>}
      {item.chart === "line" && <><LinePlot item={item} /><SeriesLegend item={item} /></>}
      {item.chart === "pie" && <><PiePlot item={item} /><PieLegend item={item} /></>}
    </div>
  );
}
