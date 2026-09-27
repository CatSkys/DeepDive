import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";
import { useFocusStream } from "../session/useFocusStream";

/* ─────────────────────────────────────────────────────────
 * THINKING — expandable agent reasoning trace
 *
 * While `running`, the header label shimmers ("思考中") and the
 * trace auto-expands: prose paragraphs fade up along a timeline
 * as reasoning deltas stream in, pinned to the newest text inside
 * a ~10-line viewport that scrolls in place once content overflows.
 * When the run settles it collapses to a quiet "已思考" row; a
 * manual toggle always wins over the automatic open/close until
 * the next run.
 * ───────────────────────────────────────────────────────── */

export function ThinkingState({
  reasoning,
  running = false,
}: {
  reasoning: string;
  running?: boolean;
}) {
  const { t } = useT();
  const [manual, setManual] = useState<boolean | null>(null);
  const expanded = manual ?? running;
  // 推理流同正文一样走受控揭示（慢逐字/快逐行），替代 delta 整段闪现
  const shown = useFocusStream(reasoning, running);
  const paragraphs = useMemo(
    () => shown.split(/\n+/).map((p) => p.trim()).filter(Boolean),
    [shown],
  );

  // The timeline rule is drawn to the measured height of the trace body so it
  // grows with the streaming content instead of being sized by the collapsed
  // grid track.
  const traceRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  // 视口跟随：true = 贴着最新文本；用户在窗口内上滚即暂停跟随，滚回底部恢复。
  const pinnedRef = useRef(true);
  const [lineHeight, setLineHeight] = useState(0);
  useLayoutEffect(() => {
    if (traceRef.current) setLineHeight(traceRef.current.offsetHeight);
  }, [paragraphs.length, expanded]);

  // 流式期间每个 delta 都吸底；已结束的轨迹展开时从头看起。
  useEffect(() => {
    const el = rowsRef.current;
    if (!el || !expanded) return;
    if (running) {
      if (pinnedRef.current) el.scrollTop = el.scrollHeight;
    } else {
      el.scrollTop = 0;
    }
  }, [paragraphs, expanded, running]);

  const onRowsScroll = () => {
    const el = rowsRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  return (
    <div className={`thinking${running ? " thinking-live" : ""}`}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={running ? t("思考中，点击收起推理") : t("已思考，点击展开推理")}
        onClick={() => setManual((current) => !(current ?? running))}
        className="thinking-head"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" className="thinking-spark" fill={running ? "var(--tk-ink-2)" : "var(--tk-ink-3)"}>
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        <span role="status" className="thinking-label-wrap">
          {running ? (
            <span className="thinking-active">{t("思考中")}</span>
          ) : (
            <span className="thinking-done">{t("已思考")}</span>
          )}
        </span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--tk-ink-3)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          className="thinking-chevron"
          style={{ transform: expanded ? "rotate(0)" : "rotate(-90deg)" }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* expandable trace: grid-rows 0fr→1fr keeps the height animated */}
      <div
        className="thinking-collapse"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          opacity: expanded ? 1 : 0,
        }}
      >
        <div className="thinking-clip">
          <div className="thinking-trace" ref={traceRef}>
            <span
              aria-hidden
              className="thinking-line"
              style={{ height: lineHeight ? lineHeight - 2 : 0 }}
            />
            <div ref={rowsRef} onScroll={onRowsScroll} className="thinking-rows">
              {paragraphs.map((p, i) => (
                <div key={i} className="thinking-row">{p}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
