// Turn 大纲轨（官方 ui-chat TurnNavigator 的移植，用户定稿放消息流左缘）：
// 每轮一枚标记；hover 出预览卡（prompt/response），点击经回调跳转（已加载
// 轮直接滚动、未加载轮由编排方深分页）。不管数据来源（outline 投影经
// props 注入）与落点计算（SessionView 持滚动容器）。

import { useEffect, useRef } from "react";
import { t, tt } from "../i18n";
import type { TurnOutlineEntry } from "../types";

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
  const listRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <nav className="turn-rail" aria-label={t("轮次导航")}>
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
              onClick={() => onPick(e)}
            >
              <span className="turn-rail-tip" aria-hidden="true">
                <span className="turn-rail-tip-head">{e.prompt || tt("第 {n} 轮", "Turn {n}", { n: e.turn })}</span>
                {e.response && <span className="turn-rail-tip-body">{e.response}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
