// Turn 大纲轨（官方 ui-chat TurnNavigator 的移植，用户定稿放消息流左缘）：
// 刻度 = 竖向胶囊（暗灰），亮白略宽的胶囊指示器常驻停在当前轮，hover 到
// 哪就弹滑到哪（spring 曲线），hover/focus 出预览卡，点击经回调跳转（已
// 加载轮直接滚动、未加载轮由编排方深分页）。不管数据来源（outline 投影
// 经 props 注入）与落点计算（SessionView 持滚动容器）。
// 预览卡必须挂在滚动容器之外——官方 .preview 是 .scroller 的兄弟；挂在
// list 内会被 overflow-y:auto 裁切（实测 hover 无卡）。
// 动效契约：tip 首次 hover 后常驻挂载（关合只翻 data-open，出场淡出由
// CSS transition 接管）；tip.top 与指示器 top 均走 transition，跨刻度是
// 弹滑不是跳变。

import { useCallback, useEffect, useRef, useState } from "react";
import { t, tt } from "../i18n";
import type { TurnOutlineEntry } from "../types";

/** 预览卡垂直夹取的半高估算（约 head+3 行 body 的一半），避免顶/底裁切。 */
const TIP_HALF_PX = 48;
/** 指示器竖向胶囊高（.turn-rail-cursor，须与 CSS 同源；比刻度高 2px 盖住它）。 */
const CURSOR_H = 12;

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
  const [tipTop, setTipTop] = useState(0);
  /** 指示器：hover 优先，否则停在活动轮；undefined=不显示（尚无可停的轮）。 */
  const [cursor, setCursor] = useState<{ turn: number; top: number } | undefined>(undefined);
  // 关合间的最后内容：出场淡出期间卡片不能变空白。
  const lastPreviewRef = useRef<TurnOutlineEntry | undefined>(undefined);

  const cursorTurn = previewTurn ?? activeTurn;

  // 指示器对齐到目标刻度（offsetTop 以 list 为定位父级，随轨内滚动自然跟随）。
  useEffect(() => {
    const list = listRef.current;
    if (!list || cursorTurn === undefined) return;
    const mark = list.querySelector<HTMLElement>(`[data-turn="${cursorTurn}"]`);
    if (!mark) return;
    setCursor({ turn: cursorTurn, top: mark.offsetTop + (mark.offsetHeight - CURSOR_H) / 2 });
  }, [cursorTurn, entries]);

  // 活动刻度平滑滚入视野；指针在轨内时不抢滚动（与官方一致）。
  useEffect(() => {
    const list = listRef.current;
    if (!list || activeTurn === undefined) return;
    if (list.matches(":hover") || list.matches(":focus-within")) return;
    const mark = list.querySelector<HTMLElement>(`[data-turn="${activeTurn}"]`);
    if (!mark) return;
    const target = mark.offsetTop - list.clientHeight / 2 + mark.offsetHeight / 2;
    if (Math.abs(target - list.scrollTop) > 4) {
      // 环境边界：jsdom 无 Element.scrollTo，WKWebView/浏览器均有
      if (typeof list.scrollTo === "function") list.scrollTo({ top: target, behavior: "smooth" });
      else list.scrollTop = target;
    }
  }, [activeTurn]);

  const placePreview = useCallback((turn: number) => {
    const list = listRef.current;
    const nav = navRef.current;
    if (!list || !nav) return;
    const mark = list.querySelector<HTMLElement>(`[data-turn="${turn}"]`);
    if (!mark) return;
    const top = mark.getBoundingClientRect().top + mark.offsetHeight / 2 - nav.getBoundingClientRect().top;
    setTipTop(Math.max(TIP_HALF_PX, Math.min(nav.clientHeight - TIP_HALF_PX, top)));
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
  useEffect(() => {
    if (preview) lastPreviewRef.current = preview;
  }, [preview]);
  const shown = preview ?? lastPreviewRef.current;

  const open = (turn: number) => {
    setPreviewTurn(turn);
    placePreview(turn);
  };

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
              onMouseEnter={() => open(e.turn)}
              onFocus={() => open(e.turn)}
              onBlur={() => setPreviewTurn(undefined)}
              onClick={() => onPick(e)}
            />
          );
        })}
        {cursor && (
          <span
            className="turn-rail-cursor"
            data-show={cursor.turn === cursorTurn || undefined}
            style={{ top: cursor.top }}
            aria-hidden="true"
          />
        )}
      </div>
      {shown && (
        <div className="turn-rail-tip" data-open={preview ? "" : undefined} style={{ top: tipTop }} aria-hidden="true">
          <span className="turn-rail-tip-head">
            {shown.prompt || tt("第 {n} 轮", "Turn {n}", { n: shown.turn })}
          </span>
          {shown.response && <span className="turn-rail-tip-body">{shown.response}</span>}
        </div>
      )}
    </nav>
  );
}
