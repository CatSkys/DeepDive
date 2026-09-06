import { useEffect, useState } from "react";
import { formatElapsed } from "../session/format";

/* ─────────────────────────────────────────────────────────
 * LOADING STATE — pixel-grid loader for long-running work
 *
 * Variants:
 *   Drive  — square cells, chevron wavefront driving right;
 *            the 650ms cycle is shorter than the sweep, so
 *            two fronts are always in flight
 *   Dots   — same wavefront, circular cells
 *   Orbit  — a comet lapping the grid perimeter
 *
 * Paired with a shimmering label and a live elapsed timer
 * in mono tabular figures. Reduced motion freezes the grid
 * to its dim state; the timer still ticks.
 * ───────────────────────────────────────────────────────── */

const chevron = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3), c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * 110;
});

const PATTERNS = {
  Drive: { delays: chevron, dur: 650, round: false },
  Dots: { delays: chevron, dur: 650, round: true },
  Orbit: { delays: orbit, dur: 950, round: false },
};

function LoaderGrid({
  delays,
  dur,
  round,
}: {
  delays: (number | null)[];
  dur: number;
  round: boolean;
}) {
  return (
    <span aria-hidden className="loader-grid">
      {delays.map((delay, index) => (
        <span
          key={index}
          className={`loader-cell${round ? " round" : ""}`}
          style={{
            opacity: delay === null ? 0.07 : 0.15,
            animation: delay === null ? "none" : `pixel-on ${dur}ms ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

/** 行内复用的 Drive 网格（不带标签/计时）：边栏任务行"运行中"槽位等小尺寸场景。 */
export function InlineLoader() {
  return <LoaderGrid {...PATTERNS.Drive} />;
}

/** Drive 网格的可调速复用点：思考强度滑杆填充区等需要同款像素波前、
 *  但节奏更缓的场景（dur 覆盖 Drive 的标准 650ms 周期）。格子配色随
 *  容器的 --ls-ink 变量走。 */
export function PixelGrid({ dur }: { dur?: number }) {
  return <LoaderGrid {...PATTERNS.Drive} dur={dur ?? PATTERNS.Drive.dur} />;
}

/**
 * Elapsed timer. `since` (epoch ms) anchors the clock
 * to the turn's real start (turn/start event time); without it the clock
 * counts from mount — the reload-mid-turn case, where no start time exists.
 */
function useElapsed(since?: number) {
  const [mountedAt] = useState(() => Date.now());
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const anchor = since ?? mountedAt;
    const tick = () => setMs(Math.max(0, Date.now() - anchor));
    tick();
    // formatElapsed 只精确到整秒：1s 节拍足够（旧 100ms 节拍服务十分位显示）
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [since, mountedAt]);
  return formatElapsed(ms);
}

export function LoadingState({
  label,
  variant = "Drive",
  /** anchor the elapsed timer to a real start time (epoch ms) */
  since,
}: {
  label?: string;
  variant?: keyof typeof PATTERNS;
  since?: number;
}) {
  const elapsed = useElapsed(since);
  const { delays, dur, round } = PATTERNS[variant];

  return (
    <div role="status" className="loading-state">
      <LoaderGrid delays={delays} dur={dur} round={round} />
      <span className="loading-label">{label ?? "Churning"}</span>
      <span className="loading-elapsed">{elapsed}</span>
    </div>
  );
}
