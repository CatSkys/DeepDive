// 侧栏外壳：「新会话」入口、横滑手势、底部设置行、菜单落点。
// 会话列表本身在 SidebarSessionList（项目行 + 分组 + 行渲染），菜单在
// SidebarContextMenus，调宽热区在 SidebarResizer——这里只管"哪片内容、摊在哪"。
import { useRef, useState } from "react";
import { CirclePlus, Folder, Settings } from "lucide-react";
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
import { sessionTitle } from "../session/sessionTitle";
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
  const [rowMenu, setRowMenu] = useState<RowMenuState | null>(null);
  const [wsMenu, setWsMenu] = useState<{ x: number; y: number } | null>(null);
  // 项目行：会话列表折叠（点行切换）与 ⋯ 菜单（重命名/删除工作区）。
  const [wsCollapsed, setWsCollapsed] = useState(false);

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
  const neighborWs = swipe.neighbor >= 0 ? store.workspaces[swipe.neighbor] : undefined;

  const closeMenus = () => { setRowMenu(null); setWsMenu(null); };
  const openRowMenu = (s: SessionSummary, x: number, y: number) => {
    setWsMenu(null);
    setRowMenu(rowMenuAt(s, sessionTitle(s, lang), x, y));
  };

  return (
    <aside
      className="sidebar"
      onWheel={swipe.wheel}
      onPointerDown={swipe.pointerDown}
      onPointerMove={swipe.pointerMove}
      onPointerUp={swipe.pointerUp}
    >
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
      {/* 静止位与两片顺序都由 swipe.dir 决定：上一空间在左（data-order="prev"）、
          下一空间在右。位移由手势直写 transform（stripRef），不经过这里的渲染——
          经 state 会让每个 pointermove 重渲整份会话列表。 */}
      <div
        className="ws-strip"
        ref={swipe.stripRef}
        data-order={swipe.dir < 0 ? "prev" : undefined}
        data-dragging={swipe.dragging || undefined}
        data-commit={swipe.commit ?? undefined}
        data-settling={swipe.settling || undefined}
      >
        <SidebarSessionList
          neighborId={neighborWs?.workspaceId}
          neighborBefore={swipe.dir < 0}
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
