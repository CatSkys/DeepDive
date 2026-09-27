// 侧栏外壳：搜索框与「新会话」入口、横滑手势、底部设置行、菜单落点。
// 会话列表本身在 SidebarSessionList（项目行 + 分组 + 行渲染），菜单在
// SidebarContextMenus，调宽热区在 SidebarResizer——这里只管"哪片内容、摊在哪"。
import { useEffect, useRef, useState } from "react";
import { CirclePlus, Folder, Search, Settings } from "lucide-react";
import { IconProjectAddOutline16 } from "./Icons";
import { useStore } from "../store";
import { comboFor, isOff } from "../keybinds";
import { useT } from "../i18n";
import { openNewProjectDialog } from "./NewProjectDialog";
import { WsSwitcher } from "./WsSwitcher";
import { useWorkspaceSwipe } from "./useWorkspaceSwipe";
import { SidebarSessionList } from "./SidebarSessionList";
import { SidebarContextMenus, rowMenuAt, type RowMenuState } from "./SidebarContextMenus";
import { SidebarResizer } from "./SidebarResizer";
import { api } from "../api";
import { sessionTitle } from "../session/sessionTitle";
import { DD_EVENTS } from "../events";
import type { SessionSummary } from "../types";

/** 顶栏工作空间胶囊（收起态专用）：文件夹图标 + 项目名，样式对齐官方 UI
 *  顶栏。展开态由 CSS 隐藏——项目名那时常驻侧栏顶部。收起态点击弹出项目
 *  切换选框（onOpen 由 SessionHeader 传入）。 */
export function WorkspacePill({ onOpen }: { onOpen?: () => void }) {
  const store = useStore();
  const ws = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId);
  if (!ws) return null;
  return (
    <span className="ws-pill" role="button" onClick={onOpen}>
      <Folder size={12} />
      <span className="ws-pill-name">{ws.title}</span>
    </span>
  );
}

export function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const store = useStore();
  const [query, setQuery] = useState("");
  /** 搜索框是否展开（非常驻）。由顶部搜索钮 / ⌘F 打开，Esc 关闭。 */
  const [searchOpen, setSearchOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null);
  const [wsMenu, setWsMenu] = useState<{ x: number; y: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // 搜索入口（顶部搜索钮 / ⌘F）：展开搜索框并聚焦；侧栏收起时先把侧栏展开
  // ——搜索框在侧栏里，侧栏不展开的话按钮点了没反应。
  // store 对象每次更新都换新引用（toggleSidebar 也在 useMemo 里内联重建），
  // 依赖它会让 window 监听随每次 store 变化重挂——改走 ref 取最新值，只挂一次。
  const storeRef = useRef(store);
  storeRef.current = store;
  useEffect(() => {
    const onFocus = () => {
      const s = storeRef.current;
      if (s.sidebarCollapsed) s.toggleSidebar();
      setSearchOpen(true);
      requestAnimationFrame(() => searchRef.current?.focus());
    };
    window.addEventListener(DD_EVENTS.focusSearch, onFocus);
    return () => window.removeEventListener(DD_EVENTS.focusSearch, onFocus);
  }, []);

  // 全文搜索（4.1）：引擎 session.search（标题∪正文）。内容命中随防抖
  // 异步到达；禁用部署（无 --patch 放行）下请求失败 → 静默降级 title-only。
  const [contentHits, setContentHits] = useState<Map<string, string>>(new Map());
  /** 全文命中被引擎截断（session/search 上限 20 条）：结果少不是没有，得说一声。 */
  const [hitsTruncated, setHitsTruncated] = useState(false);
  // 项目行：会话列表折叠（点行切换）与 ⋯ 菜单（重命名/删除工作区）。
  const [wsCollapsed, setWsCollapsed] = useState(false);

  // 全文搜索请求：≥2 字符防抖 250ms；竞态以最新 query 为准（reqRef 门）。
  const searchReqRef = useRef(0);
  const trimmedQuery = query.trim();
  useEffect(() => {
    if (trimmedQuery.length < 2) {
      setContentHits(new Map());
      setHitsTruncated(false);
      return;
    }
    const seq = ++searchReqRef.current;
    const timer = setTimeout(() => {
      void api.search({ query: trimmedQuery }).then((r) => {
        if (searchReqRef.current !== seq) return;
        setContentHits(new Map(r.items.map((x) => [x.sessionId, x.snippet])));
        setHitsTruncated(r.hasMore === true);
      }).catch(() => {
        // 引擎未放行 session.query 索引（DSH-WIRE §1）：保持 title-only
        if (searchReqRef.current === seq) { setContentHits(new Map()); setHitsTruncated(false); }
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [trimmedQuery]);

  const { t, lang } = useT();
  const hasWs = store.workspaces.length > 0;

  // 横滑方向（§2.1）：目标格子在后 → 内容自右滑入（fwd）；在前 → 自左（back）。
  // 只在 activeWorkspaceId 变化的那次渲染里算：key 相同则 .ws-pane 不重挂载，
  // 动画不会重放。首帧（prevWs 为 null）不算方向。
  const prevWs = useRef<string | null>(null);
  const slideDir = useRef<"fwd" | "back" | undefined>(undefined);
  if (store.activeWorkspaceId !== prevWs.current) {
    if (prevWs.current != null && store.activeWorkspaceId != null) {
      const idx = store.workspaces.findIndex((w) => w.workspaceId === store.activeWorkspaceId);
      const prev = store.workspaces.findIndex((w) => w.workspaceId === prevWs.current);
      slideDir.current = idx >= 0 && prev >= 0 && idx < prev ? "back" : "fwd";
    }
    prevWs.current = store.activeWorkspaceId;
  }

  // 工作区手势横滑（用户定稿：动画跟手，触控板双指或鼠标拖动推动内容，过阈值
  // 松手吸附；到头不回绕，冷却防一次长滑连切）。实现见 useWorkspaceSwipe。
  const wsIndex = store.workspaces.findIndex((w) => w.workspaceId === store.activeWorkspaceId);
  const swipe = useWorkspaceSwipe({
    index: wsIndex,
    count: store.workspaces.length,
    onCommit: (next) => { const w = store.workspaces[next]; if (w) store.switchWorkspace(w.workspaceId); },
  });
  // 拖动方向上的相邻空间：它与当前空间并排渲染，滑动过程里就在眼前（无缝衔接）。
  // 搜索态是跨空间的（搜索结果本就混排各空间），横滑没有"下一片"可言——那时并排
  // 渲染只会看到两份一样的列表，所以搜索中不挂相邻片。
  const neighborWs = trimmedQuery
    ? undefined
    : swipe.neighbor >= 0 ? store.workspaces[swipe.neighbor] : undefined;

  const closeMenus = () => { setRowMenu(null); setWsMenu(null); };
  const openRowMenu = (s: SessionSummary, x: number, y: number) => {
    setWsMenu(null);
    setRowMenu(rowMenuAt(s, sessionTitle(s, lang), x, y));
  };

  return (
    <aside
      className="sidebar"
      style={{ "--ws-drag": swipe.drag === 0 ? undefined : `${swipe.drag}px` } as React.CSSProperties}
      onWheel={swipe.wheel}
      onPointerDown={swipe.pointerDown}
      onPointerMove={swipe.pointerMove}
      onPointerUp={swipe.pointerUp}
    >
      {/* 搜索框非常驻：由顶部搜索钮 / ⌘F 打开（用户定稿——侧栏顶部让给会话列表，
          搜索收成一个按钮）。Esc 关闭并**清空**：否则输入框藏起来后列表还滤着，
          看着像会话丢了。 */}
      {searchOpen && (
        <div className="search-row" data-tip={t("搜索")} data-tip-keys={comboFor("command-palette", store.keybinds)} data-tip-pos="bottom">
          <Search size={14} />
          <input
            ref={searchRef}
            autoFocus
            placeholder={t("搜索")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.stopPropagation();
              setSearchOpen(false);
              setQuery("");
            }}
          />
        </div>
      )}
      {/* 侧栏首行「新会话」入口（§3.2 New Chat 式）：切草稿页，首条消息才建会话。
          行内已有文字与快捷键，不再挂 data-tip——提示只给没有文字的按钮用。 */}
      <button
        className="new-session-entry"
        onClick={() => store.openSession(null)}
      >
        <CirclePlus size={14} />
        <span className="ns-label">{t("新会话")}</span>
        {!isOff("new-session", store.keybinds) && (
          <span className="ns-keys">{comboFor("new-session", store.keybinds)}</span>
        )}
      </button>
      {/* 空间横滑的内容条：当前空间 + （拖动中的）相邻空间并排，整条一起平移。
          两片都用 .ws-pane 装，行高/分组/折叠状态完全一致——滑动时看到的是
          "隔壁那一片"，不是切换完才补一段滑入动画。 */}
      <div
        className="ws-strip"
        data-commit={swipe.commit ?? undefined}
        data-settling={swipe.settling || undefined}
      >
        <SidebarSessionList
          query={query}
          contentHits={contentHits}
          hitsTruncated={hitsTruncated}
          neighborId={neighborWs?.workspaceId}
          collapsed={wsCollapsed}
          onToggleCollapsed={() => setWsCollapsed((v) => !v)}
          onOpenRowMenu={openRowMenu}
          onOpenWorkspaceMenu={(x, y) => { setRowMenu(null); setWsMenu({ x, y }); }}
          onNewSession={() => store.openSession(null)}
          slideDir={slideDir.current}
        />
      </div>
      <div className="sidebar-foot">
        <button
          className="settings-entry"
          data-tip={t("设置")}
          data-tip-keys="⌘,"
          aria-label={t("设置")}
          onClick={onOpenSettings}
        >
          <Settings size={15} />
        </button>
        {hasWs && <WsSwitcher />}
        {/* ＋新建项目：打开 NewProjectDialog 表单弹窗（名称/图标/目录/指令，
            Hero 项目菜单同源；原"直接弹目录选择器"升级为表单）。 */}
        <button
          className="ws-add"
          data-tip={t("新建项目空间")}
          onClick={() => openNewProjectDialog()}
        >
          <IconProjectAddOutline16 size={15} />
        </button>
      </div>
      <SidebarContextMenus
        row={rowMenu}
        workspaceAt={wsMenu}
        onClose={closeMenus}
        onOpenSettings={onOpenSettings}
      />
      <SidebarResizer />
    </aside>
  );
}
