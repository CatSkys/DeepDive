// 统计图表的纯几何助手：平滑曲线与圆环弧路径。只算坐标，不碰数据与 DOM。

export interface Pt {
  x: number;
  y: number;
}

/** Catmull-Rom → cubic bezier 平滑折线；两端以重复端点补全切线。 */
export function smoothPath(pts: Pt[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0]!.x} ${pts[0]!.y}`;
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

/** 圆环弧段（角度制弧度，sweep>0 顺时针）；接近整圆时拆两个半圆防 arc 饱和。 */
export function arcPath(cx: number, cy: number, r: number, start: number, sweep: number): string {
  if (sweep <= 0) return "";
  const pt = (a: number) => `${(cx + r * Math.cos(a)).toFixed(3)} ${(cy + r * Math.sin(a)).toFixed(3)}`;
  if (sweep >= Math.PI * 2 - 1e-6) {
    const mid = start + Math.PI;
    return `M ${pt(start)} A ${r} ${r} 0 1 1 ${pt(mid)} A ${r} ${r} 0 1 1 ${pt(start)}`;
  }
  const large = sweep >= Math.PI ? 1 : 0;
  return `M ${pt(start)} A ${r} ${r} 0 ${large} 1 ${pt(start + sweep)}`;
}
