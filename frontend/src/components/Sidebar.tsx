// 侧栏外壳：项目行与会话列表（「新会话」末行入口在列表内）、底部设置行、菜单落点。
// 会话列表本身在 SidebarSessionList（项目行 + 分组 + 行渲染 + 末行入口），菜单在
// SidebarContextMenus，调宽热区在 SidebarResizer——这里只管"哪片内容、摊在哪"。
import { useRef, useState } from "react";
import { Folder, Settings } from "lucide-react";
import { IconProjectAddOutline16 } from "./Icons";
import { useStore } from "../store";
import { useT } from "../i18n";
import { comboFor } from "../keybinds";
import { openNewProjectDialog } from "./NewProjectDialog";
import { WsSwitcher } from "./WsSwitcher";
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

  // 切换方向：目标在后面 → 内容自右滑入（fwd）；在前面 → 自左（back）。
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

  const closeMenus = () => { setRowMenu(null); setWsMenu(null); };
  const openRowMenu = (s: SessionSummary, x: number, y: number) => {
    setWsMenu(null);
    setRowMenu(rowMenuAt(s, sessionTitle(s, lang), x, y));
  };

  return (
    <aside className="sidebar">
      {/* 当前空间的会话列表；切换空间时整片换 key 重挂载。 */}
      <SidebarSessionList
        collapsed={wsCollapsed}
        onToggleCollapsed={() => setWsCollapsed((v) => !v)}
        onOpenRowMenu={openRowMenu}
        onOpenWorkspaceMenu={(x, y) => { setRowMenu(null); setWsMenu({ x, y }); }}
        onNewSession={() => store.openSession(null)}
        slideDir={slideDir.current}
      />
      <div className="sidebar-foot">
        <button
          className="settings-entry"
          data-tip={t("设置")}
          data-tip-keys={comboFor("open-settings", store.keybinds)}
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
