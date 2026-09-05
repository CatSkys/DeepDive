// Token 活动热力图卡：近 12 个月的列=周格网。每日=日格七行（GitHub 式）、
// 每周=单行周格、累计=日格按"截至当日累计占比"着色（增长视图）。
// 悬浮格显示对应时段 tokens 与轮次；强度色走 --dsh-chart-heat1..5。
import { useMemo, useState } from "react";
import { useT } from "../i18n";
import { addDays, dayKeyOf, formatDayFull, formatDayShort, formatMonthLabel, formatTokensShort, type UsageDay } from "./usageStats";
import { ChartTip, type ChartTipState } from "./ChartTip";
import css from "./UsageSection.module.css";

type HeatMode = "daily" | "weekly" | "cumulative";

const WEEKS = 53;

interface HeatSlot {
  key: string;
  future: boolean;
  level: number;
  tip: { title: string; lines: string } | null;
}

function levelOf(v: number, max: number): number {
  if (v <= 0 || max <= 0) return 0;
  return Math.min(5, Math.max(1, Math.ceil((v / max) * 5)));
}

export function UsageHeatmap({ days }: { days: UsageDay[] }) {
  const { t, tt, lang } = useT();
  const [mode, setMode] = useState<HeatMode>("daily");
  const [tip, setTip] = useState<ChartTipState | null>(null);

  const slots = useMemo<HeatSlot[][]>(() => {
    const map = new Map(days.map((d) => [d.day, d]));
    const today = dayKeyOf(Date.now());
    const mondayOffset = (new Date().getDay() + 6) % 7;
    const colStarts = Array.from({ length: WEEKS }, (_, c) => addDays(addDays(today, -mondayOffset), (c - (WEEKS - 1)) * 7));

    // 第一遍：原始值（日值 / 周值 / 日值累计）
    const raw = colStarts.map((start) => {
      const weekTokens = Array.from({ length: 7 }, (_, i) => map.get(addDays(start, i))?.tokens ?? 0).reduce((a, b) => a + b, 0);
      return Array.from({ length: 7 }, (_, r) => {
        const key = addDays(start, r);
        return { key, future: key > today, day: map.get(key), weekTokens };
      });
    });
    const maxDaily = Math.max(0, ...raw.flat().map((c) => c.day?.tokens ?? 0));
    const maxWeek = Math.max(0, ...raw.map((col) => col[0]!.weekTokens));
    let cum = 0;
    const cumOf = raw.map((col) => col.map((cell) => (cell.future ? 0 : (cum += cell.day?.tokens ?? 0))));
    const grandTotal = Math.max(1, cum);

    // 第二遍：按模式定色阶与悬浮文案
    return raw.map((col, c) =>
      col.map((cell, r) => {
        const tokens = cell.day?.tokens ?? 0;
        const turns = cell.day?.turns ?? 0;
        const mk = (title: string, body: string): HeatSlot["tip"] => ({ title, lines: body });
        if (mode === "weekly") {
          const first = r === 0;
          const title = tt("{a} – {b}", "{a} – {b}", { a: formatDayShort(cell.key, lang), b: formatDayShort(addDays(cell.key, 6), lang) });
          return {
            key: cell.key, future: cell.future, level: first ? levelOf(cell.weekTokens, maxWeek) : 0,
            tip: first && cell.weekTokens > 0
              ? mk(title, tt("{s} tokens · {n} 轮消息", "{s} tokens · {n} messages", { s: formatTokensShort(cell.weekTokens, lang), n: turns }))
              : null,
          };
        }
        if (mode === "cumulative") {
          const c2 = cumOf[c]![r]!;
          return {
            key: cell.key, future: cell.future, level: cell.future ? 0 : levelOf(c2, grandTotal),
            tip: cell.future || (tokens === 0 && c2 === 0)
              ? null
              : mk(formatDayFull(cell.key, lang), tt("{s} tokens · 累计 {c}", "{s} tokens · {c} in total", {
                s: formatTokensShort(tokens, lang), c: formatTokensShort(c2, lang),
              })),
          };
        }
        return {
          key: cell.key, future: cell.future, level: cell.future ? 0 : levelOf(tokens, maxDaily),
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

  const solo = mode === "weekly";
  return (
    <div className={css.card}>
      <div className={css.cardHead}>
        <div className={css.cardTitle}>{t("Token 活动")}</div>
        <div className={css.seg}>
          {([["daily", "每日"], ["weekly", "每周"], ["cumulative", "累计"]] as const).map(([v, label]) => (
            <button
              key={v}
              className={`${css.segItem}${mode === v ? ` ${css.active}` : ""}`}
              onClick={() => { setMode(v); setTip(null); }}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      <div className={css.heatBody}>
        <div className={css.heatGridWrap}>
          <div className={solo ? css.heatSolo : undefined}>
            <div
              className={`${css.heatCells}${solo ? ` ${css.solo}` : ""}`}
              style={{ gridTemplateRows: solo ? "14px" : "repeat(7, 12px)", gridAutoColumns: "1fr" }}
              onMouseLeave={() => setTip(null)}
            >
              {slots.map((col, c) =>
                col.map((slot, r) => {
                  if (solo && r > 0) return null;
                  return (
                    <div
                      key={slot.key}
                      className={`${css.heatCell}${slot.level > 0 ? ` ${css[`l${slot.level}`]}` : ""}`}
                      style={solo ? { gridRow: 1, gridColumn: c + 1 } : undefined}
                      onMouseMove={(e) => showTip(e, slot)}
                    />
                  );
                }),
              )}
            </div>
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
