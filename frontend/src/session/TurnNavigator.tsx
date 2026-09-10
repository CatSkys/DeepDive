// Turn 大纲轨（官方 ui-chat TurnNavigator 的移植，用户定稿放消息流左缘）：
// 每轮一枚标记；hover/focus 出预览卡（prompt/response），点击经回调跳转（已
// 加载轮直接滚动、未加载轮由编排方深分页）。不管数据来源（outline 投影经
// props 注入）与落点计算（SessionView 持滚动容器）。
// 预览卡必须挂在滚动容器之外——官方 .preview 是 .scroller 的兄弟；挂在
// list 内会被 overflow-y:auto 裁切（实测 hover 无卡）。

import { useCallback, useEffect, useRef, useState } from "react";
import { t, tt } from "../i18n";
import type { TurnOutlineEntry } from "../types";

/** 预览卡垂直夹取的半高估算（约 head+3 行 body 的一半），避免顶/底裁切。 */
const TIP_HALF_PX = 48;

export function TurnNavigator({ entries, activeTurn, busyTurn, loadedTurns, onPick }: {
  entries: TurnOutlineEntry[];
  /** 视口当前所在轮（滚动派生，SessionView 计算后传入）。 */
  activeTurn: number | undefined;
  /** 深分页进行中的轮（标记转忙碌态）。 */
  busyTurn: number | undefined;
  /** 已在内存窗口中的轮号集（未加载的标记弱化呈现，点击走深分页）。 */
  loadedTurns: ReadonlySet<number>;
  onPick: (entry: TurnOutlineEntry) => void;
}) {
  const navRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [previewTurn, setPreviewTurn] = useState<number | undefined>(undefined);
  const [previewTop, setPreviewTop] = useState(0);

  // 活动刻度自动滚入视野；指针在轨内时不抢滚动（与官方一致）。
  useEffect(() => {
    const list = listRef.current;
    if (!list || activeTurn === undefined) return;
    if (list.matches(":hover") || list.matches(":focus-within")) return;
    const mark = list.querySelector<HTMLElement>(`[data-turn="${activeTurn}"]`);
    if (!mark) return;
    const target = mark.offsetTop - list.clientHeight / 2 + mark.offsetHeight / 2;
    if (Math.abs(target - list.scrollTop) > 4) list.scrollTop = target;
  }, [activeTurn]);

  const placePreview = useCallback((turn: number) => {
    const list = listRef.current;
    const nav = navRef.current;
    if (!list || !nav) return;
    const mark = list.querySelector<HTMLElement>(`[data-turn="${turn}"]`);
    if (!mark) return;
    const top = mark.getBoundingClientRect().top + mark.offsetHeight / 2 - nav.getBoundingClientRect().top;
    setPreviewTop(Math.max(TIP_HALF_PX, Math.min(nav.clientHeight - TIP_HALF_PX, top)));
  }, []);

  // 轨内滚动时预览卡跟手（mark 在 list 内，tip 在外，需按滚动重算）。
  useEffect(() => {
    if (previewTurn === undefined) return;
    const list = listRef.current;
    if (!list) return;
    const onScroll = () => placePreview(previewTurn);
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => list.removeEventListener("scroll", onScroll);
  }, [previewTurn, placePreview]);

  const preview = previewTurn === undefined
    ? undefined
    : entries.find((e) => e.turn === previewTurn);

  return (
    <nav
      className="turn-rail"
      aria-label={t("轮次导航")}
      ref={navRef}
      onMouseLeave={() => setPreviewTurn(undefined)}
    >
      <div className="turn-rail-list" ref={listRef}>
        {entries.map((e) => {
          const loaded = loadedTurns.has(e.turn);
          return (
            <button
              key={e.turn}
              type="button"
              data-turn={e.turn}
              className="turn-rail-mark"
              data-unloaded={!loaded || undefined}
              data-active={e.turn === activeTurn || undefined}
              aria-current={e.turn === activeTurn ? "true" : undefined}
              aria-busy={e.turn === busyTurn || undefined}
              aria-label={
                (loaded
                  ? tt("跳转到第 {n} 轮", "Jump to turn {n}", { n: e.turn })
                  : tt("载入并跳转到第 {n} 轮", "Load and jump to turn {n}", { n: e.turn }))
                + (e.prompt ? `：${e.prompt}` : "")
              }
              onMouseEnter={() => {
                setPreviewTurn(e.turn);
                placePreview(e.turn);
              }}
              onFocus={() => {
                setPreviewTurn(e.turn);
                placePreview(e.turn);
              }}
              onBlur={() => setPreviewTurn(undefined)}
              onClick={() => onPick(e)}
            />
          );
        })}
      </div>
      {preview && (
        <div className="turn-rail-tip" style={{ top: previewTop }} aria-hidden="true">
          <span className="turn-rail-tip-head">
            {preview.prompt || tt("第 {n} 轮", "Turn {n}", { n: preview.turn })}
          </span>
          {preview.response && <span className="turn-rail-tip-body">{preview.response}</span>}
        </div>
      )}
    </nav>
  );
}
