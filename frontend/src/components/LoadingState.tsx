import { useEffect, useState } from "react";

/* ─────────────────────────────────────────────────────────
 * LOADING STATE — pixel-grid loader for long-running work
 *
 * Variants:
 *   Drive  — square cells, chevron wavefront driving right;
 *            the 650ms cycle is shorter than the sweep, so
 *            two fronts are always in flight
 *   Dots   — same wavefront, circular cells
 *   Orbit  — a comet lapping the grid perimeter
 *   Surfer — the Drive loader paired with a meme video below
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

const PATTERNS: Record<string, { delays: (number | null)[]; dur: number; round: boolean }> = {
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

/**
 * Elapsed timer in tenths of a second. `since` (epoch ms) anchors the clock
 * to the turn's real start (turn/start event time); without it the clock
 * counts from mount — the reload-mid-turn case, where no start time exists.
 */
function useElapsed(since?: number) {
  const [mountedAt] = useState(() => Date.now());
  const [ds, setDs] = useState(0);
  useEffect(() => {
    const anchor = since ?? mountedAt;
    const tick = () => setDs(Math.max(0, Math.round((Date.now() - anchor) / 100)));
    tick();
    const t = setInterval(tick, 100);
    return () => clearInterval(t);
  }, [since, mountedAt]);
  const total = ds / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

export default function LoadingState({
  label,
  variant = "Drive",
  /** anchor the elapsed timer to a real start time (epoch ms) */
  since,
  /** the meme feed for the Surfer variant; drop the file in dist/ to light it up */
  videoSrc = "/subway-surfers.mp4",
}: {
  label?: string;
  variant?: string;
  since?: number;
  videoSrc?: string;
}) {
  const elapsed = useElapsed(since);
  const surfer = variant === "Surfer";
  const resolvedLabel = label ?? (surfer ? "Subway surfing" : "Churning");
  const [videoOk, setVideoOk] = useState(true);
  const { delays, dur, round } = PATTERNS[variant] ?? PATTERNS.Drive;

  const labelEl = <span className="loading-label">{resolvedLabel}</span>;
  const elapsedEl = <span className="loading-elapsed">{elapsed}</span>;

  if (surfer) {
    return (
      <div role="status" className="loading-state stack">
        <div className="loading-state-row">
          <LoaderGrid {...PATTERNS.Drive} />
          {labelEl}
          {elapsedEl}
        </div>

        {/* the context card follows the status text it is illustrating */}
        <div className="loading-card">
          <div className="loading-video">
            {videoOk ? (
              <video
                src={videoSrc}
                autoPlay
                muted
                loop
                playsInline
                onError={() => setVideoOk(false)}
                className="loading-video-el"
              />
            ) : (
              <div className="loading-video-fallback">
                <LoaderGrid {...PATTERNS.Drive} />
                <span className="loading-video-note">Video unavailable</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div role="status" className="loading-state">
      <LoaderGrid delays={delays} dur={dur} round={round} />
      {labelEl}
      {elapsedEl}
    </div>
  );
}
