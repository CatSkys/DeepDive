// 命令中心的**历史模式**行件：按日期分段的会话行（两行式——标题 + 元信息行，
// 照参考图），行的「更多」与右键复用侧栏那份会话行菜单（含删除）。
// 只管这一模式的取数排布与交互：搜索词/键盘由命令中心（MiniCommandCenter）给进来，
// 取数过滤分段全在 miniHistoryView.ts（纯函数、有单测）。
// 不做筛选/排序控件（用户 2026-10-13 定稿：历史那一排直接删掉，段序恒为日期）。
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Ellipsis } from "lucide-react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { fmtTime } from "../session/sessionTime";
import { Spinner } from "../components/LoadingState";
import { HoverScrollText } from "../components/HoverScrollText";
import { SidebarContextMenus, type RowMenuState } from "../components/SidebarContextMenus";
import { filterHistory, groupByDate, historyItems, type HistoryItem } from "./miniHistoryView";
import type { KeyHandler } from "./MiniCommandCenter";

export function MiniHistoryRows({
  query,
  registerKeys,
  onDone,
}: {
  query: string;
  /** 把 ↑↓/Enter 交给命令中心：它的搜索框拿着焦点，行件的处理每次渲染注册一份最新的。 */
  registerKeys: (handler: KeyHandler) => void;
  /** 点行开完会话、或用户选了别的动作之后收掉浮层。 */
  onDone: () => void;
}) {
  const store = useStore();
  const { t, lang } = useT();
  const [cursor, setCursor] = useState(0);
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 锚点 = 面板当前所在空间（= 快捷空间）：不依赖壳下发的 quickWorkspacePath
  // （那条曾整条落空 → 列表恒空，见 MiniPanelApp 的 get-prefs 注释）。
  // 空间归属规则与侧栏同一份（摘要缺映射落回第一空间，见 miniHistoryView 头注）。
  const anchorWorkspaceId = store.activeWorkspaceId ?? store.workspaces[0]?.workspaceId ?? "";
  const items = useMemo(
    () =>
      historyItems(store.sidebarSessions, {
        workspaceId: anchorWorkspaceId,
        fallbackWorkspaceId: store.workspaces[0]?.workspaceId,
        workspaceOf: store.wsOfSession,
        pinned: store.pinned,
        unread: store.unread,
        lang,
      }),
    [store.sidebarSessions, store.wsOfSession, store.pinned, store.unread, store.workspaces, anchorWorkspaceId, lang],
  );
  const visible = useMemo(() => filterHistory(items, query), [items, query]);
  const sections = useMemo(() => groupByDate(visible, { lang, t }), [visible, lang, t]);
  /** 键盘光标的行序：段序即视觉序。 */
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const cursorOf = useMemo(() => new Map(flat.map((it, i) => [it.sessionId, i])), [flat]);

  // 过滤后行数变小：光标越界就回零。
  useEffect(() => {
    setCursor((c) => (c < flat.length ? c : 0));
  }, [flat.length]);

  // 光标移动后把它滚进视野（block:nearest——已可见则不动）。
  useEffect(() => {
    listRef.current?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor, flat.length]);

  useEffect(() => {
    registerKeys((e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (flat.length === 0) return true;
        setCursor((c) => (e.key === "ArrowDown" ? Math.min(c + 1, flat.length - 1) : Math.max(c - 1, 0)));
        return true;
      }
      if (e.key === "Enter") {
        const target = flat[cursor];
        if (!target) return false;
        e.preventDefault();
        store.openSession(target.sessionId);
        onDone();
        return true;
      }
      return false;
    });
  });

  const statusWord = (it: HistoryItem) => (it.running ? t("运行中") : it.unread ? t("未读") : t("已完成"));

  return (
    <>
      <div className="mini-cc-list" ref={listRef}>
        {sections.map((section) => (
          <section className="mini-cc-section" key={section.key}>
            {section.title !== null && <h3 className="mini-cc-section-title">{section.title}</h3>}
            {section.items.map((it) => (
              <button
                key={it.sessionId}
                type="button"
                className={`task-row mini-cc-row${it.sessionId === store.activeSessionId ? " selected" : ""}${it.running ? " running" : ""}`}
                data-cursor={cursorOf.get(it.sessionId) === cursor || undefined}
                onClick={() => {
                  store.openSession(it.sessionId);
                  onDone();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setRowMenu({ sessionId: it.sessionId, title: it.title, cwd: it.cwd, x: e.clientX, y: e.clientY });
                }}
              >
                <span className="row-slot">
                  {it.running ? <Spinner /> : it.unread ? <span className="unread-dot" /> : null}
                </span>
                <span className="row-main">
                  <span className="row-title-line">
                    <HoverScrollText className="title">{it.title}</HoverScrollText>
                  </span>
                  <span className="mini-cc-row-meta">
                    {`${fmtTime(it.updatedAt, lang)} · ${statusWord(it)}`}
                  </span>
                </span>
                <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="mini-cc-more"
                    aria-label={t("更多")}
                    data-tip={t("更多")}
                    onClick={(e) => {
                      // stopPropagation：别让这次点击既开菜单又立刻触发外点关闭
                      e.stopPropagation();
                      const r = e.currentTarget.getBoundingClientRect();
                      setRowMenu({ sessionId: it.sessionId, title: it.title, cwd: it.cwd, x: r.right - 8, y: r.bottom + 4 });
                    }}
                  >
                    <Ellipsis size={14} />
                  </button>
                </span>
              </button>
            ))}
          </section>
        ))}
        {visible.length === 0 && <p className="mini-cc-empty">{query !== "" ? t("没有匹配的会话") : t("暂无会话")}</p>}
      </div>
      <SidebarContextMenus row={rowMenu} workspaceAt={null} onClose={() => setRowMenu(null)} />
    </>
  );
}
