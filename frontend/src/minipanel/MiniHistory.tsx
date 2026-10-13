// 迷你面板的「会话历史」脸（Atd task-history 的裁剪版）：标题行 + 搜索 + 排序分组菜单 +
// 按分组分段的会话列表 + 两种空态。点行开会话并回到原脸；行的「更多」与右键复用侧栏那份
// 会话行菜单（同一份，不开第二份拷贝）。
// 取数/过滤/分组排序全在 miniHistoryView.ts（纯函数、有单测），偏好存在 miniHistoryPrefs.ts，
// 这里只管渲染与交互。
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, Ellipsis, History, Search, SlidersHorizontal, X } from "lucide-react";
import { useStore } from "../store";
import { usePrefs } from "../prefs";
import { useT } from "../i18n";
import { fmtTime } from "../session/sessionTime";
import { Spinner } from "../components/LoadingState";
import { HoverScrollText } from "../components/HoverScrollText";
import { SidebarContextMenus, type RowMenuState } from "../components/SidebarContextMenus";
import { filterHistory, groupAndSort, historyItems, type HistoryGroup, type HistoryItem, type HistorySort } from "./miniHistoryView";
import { useMiniHistoryView } from "./miniHistoryPrefs";

/** 排序与分组菜单的两组选项（数组顺序即菜单顺序）。 */
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

export function MiniHistory({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const { t, tt, lang } = useT();
  const { quickWorkspacePath } = usePrefs();
  const [view, setView] = useMiniHistoryView();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null);
  const [viewMenuAt, setViewMenuAt] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const viewBtnRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 打开历史就把焦点交给搜索框：壳的 quickPanelFocus 只推给会话输入框，历史脸下那个
  // 输入框不在，焦点该落在这里（Atd 的历史视图同样以搜索框为焦点目标）。
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 排序与分组菜单：随手在 window click 关掉（与侧栏那两份菜单同一套收口方式）。
  useEffect(() => {
    if (!viewMenuAt) return;
    const close = () => setViewMenuAt(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [viewMenuAt]);

  // 只列快捷会话空间（空间归属规则与侧栏同一份，见 miniHistoryView 头注）。
  const quickWorkspaceId = store.workspaces.find((w) => w.path === quickWorkspacePath)?.workspaceId;
  const items = useMemo(
    () =>
      historyItems(store.sidebarSessions, {
        workspaceId: quickWorkspaceId ?? "",
        fallbackWorkspaceId: store.workspaces[0]?.workspaceId,
        workspaceOf: store.wsOfSession,
        pinned: store.pinned,
        unread: store.unread,
        lang,
      }),
    [store.sidebarSessions, store.wsOfSession, store.pinned, store.unread, store.workspaces, quickWorkspaceId, lang],
  );
  const visible = useMemo(() => filterHistory(items, query), [items, query]);
  const sections = useMemo(
    () => groupAndSort(visible, { group: view.group, sort: view.sort, lang, t }),
    [visible, view, lang, t],
  );
  /** 键盘光标的行序：段序即视觉序。 */
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const cursorOf = useMemo(() => new Map(flat.map((it, i) => [it.sessionId, i])), [flat]);

  // 过滤/换分组后行数变小：光标越界就回零，别停在一个不存在的下标上。
  useEffect(() => {
    setCursor((c) => (c < flat.length ? c : 0));
  }, [flat.length]);

  // 光标移动后把它滚进视野（block:nearest——已可见则不动）。
  useEffect(() => {
    listRef.current?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor, flat.length]);

  const open = (sessionId: string) => {
    store.openSession(sessionId);
    onClose();
  };

  const onSearchKeys = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      // 两段式：先在搜索框里清空，空搜索时再按才退出历史回原脸。
      if (query !== "") setQuery("");
      else onClose();
      return;
    }
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
      open(target.sessionId);
    }
  };

  const renderRow = (it: HistoryItem) => (
    <button
      key={it.sessionId}
      type="button"
      className={`task-row mini-history-row${it.sessionId === store.activeSessionId ? " selected" : ""}${it.running ? " running" : ""}${it.unread ? " unread" : ""}`}
      data-cursor={cursorOf.get(it.sessionId) === cursor || undefined}
      onClick={() => open(it.sessionId)}
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
      </span>
      <span className="row-actions" onClick={(e) => e.stopPropagation()}>
        <span className="row-time">{fmtTime(it.updatedAt, lang)}</span>
        <button
          type="button"
          className="mini-history-more"
          aria-label={t("更多")}
          data-tip={t("更多")}
          onClick={(e) => {
            // stopPropagation：别让这次点击既开菜单又立刻触发外点关闭
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            setRowMenu({ sessionId: it.sessionId, title: it.title, cwd: it.cwd, x: r.right - 8, y: r.bottom + 4 });
          }}
        >
          <Ellipsis size={13} />
        </button>
      </span>
    </button>
  );

  return (
    <div className="session-row">
      <div className="mini-history">
        <div className="session-header">
          <div className="left">
            <div className="title-row">
              <span className="title-anchor">
                <div className="title">{t("会话历史")}</div>
              </span>
            </div>
          </div>
        </div>
        <div className="mini-history-search-row">
          <label className="mini-history-search">
            <Search size={14} aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              placeholder={t("搜索会话…")}
              aria-label={t("搜索会话…")}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={onSearchKeys}
            />
            {query !== "" && (
              <button
                type="button"
                className="mini-history-clear"
                aria-label={t("清空")}
                data-tip={t("清空")}
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
              >
                <X size={13} />
              </button>
            )}
          </label>
          <button
            ref={viewBtnRef}
            type="button"
            className="panel-expand-btn"
            aria-expanded={viewMenuAt !== null}
            aria-label={t("排序与分组")}
            data-tip={t("排序与分组")}
            onClick={(e) => {
              e.stopPropagation();
              const r = viewBtnRef.current?.getBoundingClientRect();
              setViewMenuAt(viewMenuAt ? null : { x: Math.max(8, (r?.right ?? 0) - 180), y: (r?.bottom ?? 0) + 6 });
            }}
          >
            <SlidersHorizontal size={15} />
          </button>
        </div>
        <div className="mini-history-list" ref={listRef}>
          {sections.map((section) => (
            <section className="mini-history-section" key={section.key}>
              {section.title !== null && <h3 className="mini-history-section-title">{section.title}</h3>}
              {section.items.map(renderRow)}
            </section>
          ))}
          {visible.length === 0 && (
            <div className="mini-history-empty">
              {query !== "" ? <Search size={16} aria-hidden="true" /> : <History size={16} aria-hidden="true" />}
              <p>{query !== "" ? tt("没有匹配「{q}」的会话", "No sessions match “{q}”", { q: query.trim() }) : t("暂无会话")}</p>
            </div>
          )}
        </div>
        {viewMenuAt && (
          <div
            className="ctx-menu mini-history-view-menu"
            style={{ top: viewMenuAt.y, left: viewMenuAt.x }}
            onClick={(e) => e.stopPropagation()}
          >
            {GROUPS.map((g) => (
              <div
                className="ctx-item"
                key={g.id}
                data-on={view.group === g.id || undefined}
                onClick={() => {
                  setView({ group: g.id });
                  setViewMenuAt(null);
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
                  setViewMenuAt(null);
                }}
              >
                {t(s.label)}
                {view.sort === s.id && <Check size={13} />}
              </div>
            ))}
          </div>
        )}
        <SidebarContextMenus row={rowMenu} workspaceAt={null} onClose={() => setRowMenu(null)} />
      </div>
    </div>
  );
}
