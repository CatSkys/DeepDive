// 命令中心的**历史模式**行件：按分组分段的会话行（两行式——标题 + 元信息行，
// 照参考图），行的「更多」与右键复用侧栏那份会话行菜单（含删除）。
// 只管这一模式的取数排布与交互：搜索词/键盘由命令中心（MiniCommandCenter）给进来，
// 取数过滤分组排序全在 miniHistoryView.ts（纯函数、有单测），偏好存在 miniHistoryPrefs.ts。
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, Ellipsis, SlidersHorizontal } from "lucide-react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { fmtTime } from "../session/sessionTime";
import { Spinner } from "../components/LoadingState";
import { HoverScrollText } from "../components/HoverScrollText";
import { SidebarContextMenus, type RowMenuState } from "../components/SidebarContextMenus";
import { filterHistory, groupAndSort, historyItems, type HistoryGroup, type HistoryItem, type HistorySort } from "./miniHistoryView";
import { useMiniHistoryView } from "./miniHistoryPrefs";

const GROUPS: { id: HistoryGroup; label: string }[] = [
  { id: "date", label: "按日期分组" },
  { id: "status", label: "按状态分组" },
  { id: "agent", label: "按智能体分组" },
  { id: "none", label: "不分组" },
];
const SORTS: { id: HistorySort; label: string }[] = [
  { id: "updated", label: "最近更新" },
  { id: "title", label: "标题" },
];

export function MiniHistoryRows({
  query,
  registerNav,
  onDone,
}: {
  query: string;
  /** 把 ↑↓/Enter 交给命令中心：它的搜索框拿着焦点，行件的处理每次渲染注册一份最新的。 */
  registerNav: (handler: (e: ReactKeyboardEvent<HTMLInputElement>) => void) => void;
  /** 点行开完会话、或用户选了别的动作之后收掉浮层。 */
  onDone: () => void;
}) {
  const store = useStore();
  const { t, lang } = useT();
  const [view, setView] = useMiniHistoryView();
  const [cursor, setCursor] = useState(0);
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null);
  const [viewMenu, setViewMenu] = useState(false);
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
  const sections = useMemo(
    () => groupAndSort(visible, { group: view.group, sort: view.sort, lang, t }),
    [visible, view, lang, t],
  );
  /** 键盘光标的行序：段序即视觉序。 */
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const cursorOf = useMemo(() => new Map(flat.map((it, i) => [it.sessionId, i])), [flat]);

  // 过滤/换分组后行数变小：光标越界就回零。
  useEffect(() => {
    setCursor((c) => (c < flat.length ? c : 0));
  }, [flat.length]);

  // 光标移动后把它滚进视野（block:nearest——已可见则不动）。
  useEffect(() => {
    listRef.current?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor, flat.length]);

  useEffect(() => {
    registerNav((e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (flat.length === 0) return;
        setCursor((c) => (e.key === "ArrowDown" ? Math.min(c + 1, flat.length - 1) : Math.max(c - 1, 0)));
        return;
      }
      if (e.key === "Enter") {
        const target = flat[cursor];
        if (!target) return;
        e.preventDefault();
        store.openSession(target.sessionId);
        onDone();
      }
    });
  });

  const statusWord = (it: HistoryItem) => (it.running ? t("运行中") : it.unread ? t("未读") : t("已完成"));

  return (
    <>
      {/* 排序与分组：命令中心里它就是一条工具行（值即当前组合），点开是那份菜单 */}
      <div className="mini-cc-tools">
        <button
          type="button"
          className="mini-cc-tool"
          aria-expanded={viewMenu}
          aria-label={t("排序与分组")}
          data-tip={t("排序与分组")}
          onClick={(e) => {
            e.stopPropagation();
            setViewMenu((v) => !v);
          }}
        >
          <SlidersHorizontal size={14} />
          <span>{`${t(GROUPS.find((g) => g.id === view.group)?.label ?? "按日期分组")} · ${t(SORTS.find((s) => s.id === view.sort)?.label ?? "最近更新")}`}</span>
        </button>
      </div>
      {viewMenu && (
        <div className="ctx-menu mini-cc-view-menu" onClick={(e) => e.stopPropagation()}>
          {GROUPS.map((g) => (
            <div
              className="ctx-item"
              key={g.id}
              data-on={view.group === g.id || undefined}
              onClick={() => {
                setView({ group: g.id });
                setViewMenu(false);
              }}
            >
              {t(g.label)}
              {view.group === g.id && <Check size={13} />}
            </div>
          ))}
          <div className="ctx-sep" />
          {SORTS.map((s) => (
            <div
              className="ctx-item"
              key={s.id}
              data-on={view.sort === s.id || undefined}
              onClick={() => {
                setView({ sort: s.id });
                setViewMenu(false);
              }}
            >
              {t(s.label)}
              {view.sort === s.id && <Check size={13} />}
            </div>
          ))}
        </div>
      )}
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
