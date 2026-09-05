// Token 活动热力图卡：近 12 个月的列=周 × 七行日格网格，三种模式共用同一
// 网格几何。每日=按日着色；每周=整列共用该周聚合值，悬浮时整列并成一格
// 显示"当周"聚合；累计=按"截至当日累计占比"着色（增长视图）。
// 强度色走 --dsh-chart-heat1..5。
import { useMemo, useState } from "react";
import { useT } from "../i18n";
import { addDays, dayKeyOf, formatDayFull, formatMonthLabel, formatTokensShort, type UsageDay } from "./usageStats";
import { ChartTip, type ChartTipState } from "./ChartTip";
import css from "./UsageSection.module.css";

type HeatMode = "daily" | "weekly" | "cumulative";

const WEEKS = 53;

interface HeatSlot {
  key: string;
  future: boolean;
  level: number;
  col: number;
  /** hoverCol：每周模式整列并格用；非每周为 null。 */
  tip: { title: string; lines: string; col: number } | null;
}

function levelOf(v: number, max: number): number {
  if (v <= 0 || max <= 0) return 0;
  return Math.min(5, Math.max(1, Math.ceil((v / max) * 5)));
}

export function UsageHeatmap({ days }: { days: UsageDay[] }) {
  const { t, tt, lang } = useT();
  const [mode, setMode] = useState<HeatMode>("daily");
  const [tip, setTip] = useState<ChartTipState | null>(null);
  const [hoverCol, setHoverCol] = useState<number | null>(null);

  const slots = useMemo<HeatSlot[][]>(() => {
    const map = new Map(days.map((d) => [d.day, d]));
    const today = dayKeyOf(Date.now());
    const mondayOffset = (new Date().getDay() + 6) % 7;
    const colStarts = Array.from({ length: WEEKS }, (_, c) => addDays(addDays(today, -mondayOffset), (c - (WEEKS - 1)) * 7));

    // 第一遍：原始值（日值 / 周值 / 日值累计）
    const raw = colStarts.map((start) => {
      const week = Array.from({ length: 7 }, (_, i) => map.get(addDays(start, i)) ?? { tokens: 0, turns: 0 })
        .reduce((a, b) => ({ tokens: a.tokens + b.tokens, turns: a.turns + b.turns }), { tokens: 0, turns: 0 });
      return { start, week, cells: Array.from({ length: 7 }, (_, r) => {
        const key = addDays(start, r);
        return { key, future: key > today, day: map.get(key) };
      }) };
    });
    const maxDaily = Math.max(0, ...raw.flatMap((c) => c.cells.map((x) => x.day?.tokens ?? 0)));
    const maxWeek = Math.max(0, ...raw.map((c) => c.week.tokens));
    let cum = 0;
    const cumOf = raw.map((col) => col.cells.map((cell) => (cell.future ? 0 : (cum += cell.day?.tokens ?? 0))));
    const grandTotal = Math.max(1, cum);

    // 第二遍：按模式定色阶与悬浮文案（悬浮文案挂在列首格，整列共享）
    return raw.map((col, c) =>
      col.cells.map((cell, r) => {
        const tokens = cell.day?.tokens ?? 0;
        const turns = cell.day?.turns ?? 0;
        const mk = (title: string, body: string): HeatSlot["tip"] => ({ title, lines: body, col: c });
        if (mode === "weekly") {
          // 整列共用周聚合：七格同色同提示；空周也出提示（对照官方"当周"行为）
          const tipText = mk(
            tt("{d} 当周", "Week of {d}", { d: formatDayFull(col.start, lang) }),
            tt("{s} tokens · {n} 轮消息", "{s} tokens · {n} messages", { s: formatTokensShort(col.week.tokens, lang), n: col.week.turns }),
          )!;
          return {
            key: cell.key, future: cell.future, col: c,
            level: cell.future ? 0 : levelOf(col.week.tokens, maxWeek),
            tip: tipText,
          };
        }
        if (mode === "cumulative") {
          const c2 = cumOf[c]![r]!;
          return {
            key: cell.key, future: cell.future, col: c, level: cell.future ? 0 : levelOf(c2, grandTotal),
            tip: cell.future || (tokens === 0 && c2 === 0)
              ? null
              : mk(formatDayFull(cell.key, lang), tt("{s} tokens · 累计 {c}", "{s} tokens · {c} in total", {
                s: formatTokensShort(tokens, lang), c: formatTokensShort(c2, lang),
              })),
          };
        }
        return {
          key: cell.key, future: cell.future, col: c, level: cell.future ? 0 : levelOf(tokens, maxDaily),
          tip: cell.future || !cell.day ? null : mk(
            formatDayFull(cell.key, lang),
            tt("{s} tokens · {n} 轮消息", "{s} tokens · {n} messages", { s: formatTokensShort(tokens, lang), n: turns }),
          ),
        };
      }),
    );
  }, [days, mode, lang, tt]);

  const months = useMemo(() => {
    const today = dayKeyOf(Date.now());
    const mondayOffset = (new Date().getDay() + 6) % 7;
    const colStarts = Array.from({ length: WEEKS }, (_, c) => addDays(addDays(today, -mondayOffset), (c - (WEEKS - 1)) * 7));
    const out: { col: number; label: string }[] = [];
    for (let c = 1; c < colStarts.length; c++) {
      const m = colStarts[c]!.slice(0, 7);
      if (m !== colStarts[c - 1]!.slice(0, 7)) out.push({ col: c, label: formatMonthLabel(m, lang) });
    }
    return out;
  }, [lang]);

  const showTip = (e: React.MouseEvent, slot: HeatSlot) => {
    setHoverCol(slot.col);
    if (!slot.tip) return;
    setTip({
      x: e.clientX,
      y: e.clientY,
      content: (
        <>
          <div className={css.tipTitle}>{slot.tip.title}</div>
          <div className={css.tipRow}><span className={css.tipMuted}>{slot.tip.lines}</span></div>
        </>
      ),
    });
  };
  const clearHover = () => { setTip(null); setHoverCol(null); };

  return (
    <div className={css.card}>
      <div className={css.cardHead}>
        <div className={css.cardTitle}>{t("Token 活动")}</div>
        <div className={css.seg}>
          {([["daily", "每日"], ["weekly", "每周"], ["cumulative", "累计"]] as const).map(([v, label]) => (
            <button
              key={v}
              className={`${css.segItem}${mode === v ? ` ${css.active}` : ""}`}
              onClick={() => { setMode(v); clearHover(); }}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      <div className={css.heatBody}>
        <div className={css.heatGridWrap}>
          <div
            className={css.heatCells}
            style={{ gridTemplateRows: "repeat(7, 12px)", gridAutoColumns: "1fr" }}
            onMouseLeave={clearHover}
          >
            {slots.map((col, c) =>
              col.map((slot) => {
                // 每周模式悬浮列：七格让位给合并大格，避免透出格间缝
                if (mode === "weekly" && hoverCol === c) return null;
                return (
                  <div
                    key={slot.key}
                    className={`${css.heatCell}${slot.level > 0 ? ` ${css[`l${slot.level}`]}` : ""}`}
                    onMouseMove={(e) => showTip(e, slot)}
                  />
                );
              }),
            )}
            {/* 每周模式悬浮：整列并成一格（跨七行盖住列区间） */}
            {mode === "weekly" && hoverCol !== null && (
              <div
                className={`${css.heatCell} ${css.heatCellMerged} ${slots[hoverCol]![0]!.level > 0 ? css[`l${slots[hoverCol]![0]!.level}`] : ""}`}
                style={{ gridRow: "1 / span 7", gridColumn: hoverCol + 1 }}
                onMouseMove={(e) => { const s = slots[hoverCol]![0]!; if (s.tip) showTip(e, s); }}
              />
            )}
          </div>
          <div className={css.heatMonths} style={{ gridTemplateColumns: `repeat(${WEEKS}, 1fr)` }}>
            {months.map((m) => (
              <div key={m.col} className={css.heatMonth} style={{ gridColumn: `${m.col + 1} / span 3` }}>
                {m.label}
              </div>
            ))}
          </div>
        </div>
      </div>
      <ChartTip tip={tip} />
    </div>
  );
}
