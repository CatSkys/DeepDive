// 自进化的图表数据（纯函数）：状态构成（环图）与近 30 天活动（柱状）。
// 只管把台账摊成图上的数字，不管渲染——渲染在 Charts.tsx。

import type { LessonProposal } from "./protocol";
import type { EvolutionRun } from "./store";

export interface Slice {
  /** 语义键：渲染端据此取色（青=有效、红=无效、中性=其余）。 */
  key: "pending" | "applied" | "effective" | "ineffective" | "dismissed" | "expired";
  label: [string, string];
  value: number;
}

/** 状态构成：一条经验只归一类（有效/无效优先于"已交办"）。 */
export function statusSlices(proposals: readonly LessonProposal[]): Slice[] {
  const count = (f: (p: LessonProposal) => boolean) => proposals.filter(f).length;
  const all: Slice[] = [
    { key: "pending", label: ["待审", "pending"], value: count((p) => p.status === "pending") },
    { key: "effective", label: ["有效", "effective"], value: count((p) => p.verdict?.verdict === "effective") },
    { key: "ineffective", label: ["无效", "ineffective"], value: count((p) => p.verdict?.verdict === "ineffective") },
    { key: "applied", label: ["待校验", "awaiting check"], value: count((p) => p.status === "applied" && (p.verdict === undefined || p.verdict.verdict === "unverified")) },
    { key: "dismissed", label: ["已丢弃", "dismissed"], value: count((p) => p.status === "dismissed" && p.verdict === undefined) },
    { key: "expired", label: ["已退役", "retired"], value: count((p) => p.status === "expired" && p.verdict === undefined) },
  ];
  return all.filter((s) => s.value > 0);
}

export interface ActivityDay {
  /** 本地日期键 YYYY-MM-DD。 */
  key: string;
  /** 当天新增提案数。 */
  created: number;
  /** 当天落库 / 校验 / 复盘 / 撤销 的交办次数。 */
  runs: number;
}

const dayKey = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** 近 days 天的活动（含今天）：新增提案与交办次数按本地日归集。 */
export function activityDays(
  proposals: readonly LessonProposal[],
  runs: readonly EvolutionRun[],
  now: number,
  days: number,
): ActivityDay[] {
  const out: ActivityDay[] = [];
  const index = new Map<string, ActivityDay>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const day: ActivityDay = { key: dayKey(d.getTime()), created: 0, runs: 0 };
    out.push(day);
    index.set(day.key, day);
  }
  for (const p of proposals) {
    const hit = index.get(dayKey(p.createdAt));
    if (hit) hit.created += 1;
  }
  for (const r of runs) {
    const hit = index.get(dayKey(r.at));
    if (hit) hit.runs += 1;
  }
  return out;
}

/** 活动峰值的下限：全 0 时也给一根可见的基线。 */
export function activityMax(days: readonly ActivityDay[]): number {
  return Math.max(1, ...days.map((d) => d.created + d.runs));
}
