import { useEffect, useState } from "react";
import { t } from "../i18n";
import { formatElapsed } from "../session/format";

/* ─────────────────────────────────────────────────────────
 * LOADING — 两种在跑指示
 *
 *   LoadingState — 会话流末那一行：只有文字（微光扫过的标签 +
 *                  走等宽表格数字的计时）。onClick（DeepDiving 入口，
 *                  TurnList 传）时整行成 button——不加任何图标
 *   Spinner      — 行内转圈：DashRing 那一款（淡轨道 + 一段会伸缩
 *                  的弧）。边栏任务行槽位与浏览器标签的加载中共用
 *                  一枚；配色/线宽在 theme.css 的 .spin-ring
 * ───────────────────────────────────────────────────────── */

/* 转圈几何：半径 5.3（线宽 1.4 的一半正好贴满 12 的框）。弧长按周长算——和
   UsageMeter 同一做法，dasharray 落的是绝对用户单位，改 r 只改这一处；不引 SVG 的
   pathLength 归一（那条在本宿主的 WKWebView 上没验过，不想让"圈有没有缺口"押在它身上）。 */
const RING_R = 5.3;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R;
const ringDash = (fraction: number) => (RING_CIRCUMFERENCE * fraction).toFixed(2);
const RING_GAP = RING_CIRCUMFERENCE.toFixed(2);
/** 弧长在周长的 10%–70% 之间来回（参考 DashRing：短—长—短，没有满圈那一刻）。 */
const ARC_SHORT = ringDash(0.1);
const ARC_LONG = ringDash(0.7);

/** 行内转圈：淡轨道 + 会伸缩的弧，弧边转边长（DashRing 那一款——"streaming" 的观感，
   比固定缺口的圈更像"一直在跑"）。**dash 长度的补间只有 SMIL 能表达**（CSS 里动画
   stroke-dasharray 各浏览器不保证），所以伸缩走 <animate>；旋转仍归 CSS 的 --loop-spin，
   两者周期不同拍，转起来不呆板。`label` 给了才进无障碍树——边栏槽位里那枚是行标题的
   附注，装饰性（aria-hidden）。 */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <svg
      className={className ? `spin-ring ${className}` : "spin-ring"}
      viewBox="0 0 12 12"
      width="12"
      height="12"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle className="spin-ring-track" cx="6" cy="6" r={RING_R} />
      <circle className="spin-ring-arc" cx="6" cy="6" r={RING_R} strokeDasharray={`${ARC_SHORT} ${RING_GAP}`}>
        <animate
          attributeName="stroke-dasharray"
          dur="1.6s"
          repeatCount="indefinite"
          calcMode="spline"
          values={`${ARC_SHORT} ${RING_GAP};${ARC_LONG} ${RING_GAP};${ARC_SHORT} ${RING_GAP}`}
          keyTimes="0;0.5;1"
          keySplines="0.4 0 0.2 1;0.4 0 0.2 1"
        />
      </circle>
    </svg>
  );
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
  /** anchor the elapsed timer to a real start time (epoch ms) */
  since,
  /** DeepDiving 入口：给了就整行成 button（流末 loader「Deep diving...」）。 */
  onClick,
}: {
  label: string;
  since?: number;
  onClick?: () => void;
}) {
  const elapsed = useElapsed(since);
  const body = (
    <>
      <span role="status" className="loading-label">{label}</span>
      <span className="loading-elapsed">{elapsed}</span>
    </>
  );
  if (!onClick) return <div className="loading-state">{body}</div>;
  return (
    <button type="button" className="loading-state" aria-label={t("打开 DeepDiving")} onClick={onClick}>
      {body}
    </button>
  );
}
