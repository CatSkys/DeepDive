import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { WorkspaceView } from "../types";
import { revealPath } from "../host";
import { api } from "../api";
import { useStore } from "../store";
import { clearWsIcon, getWsIcon, setWsIcon } from "../wsIcons";
import { openIconPickerAt } from "./IconPicker";
import { openEditProjectDialog } from "./EditProjectDialog";
import { alertDialog, confirmDialog, promptDialog } from "./DialogHost";
import { useT } from "../i18n";
import { GlassLayer } from "./GlassLayer";
import { placeFloating } from "./floatingPlacement";

// 项目（工作区）的"文件夹"类动作：打开项目文件夹 / 复制路径。
//
// 三处入口共用**同一份动作项**（hero 项目胶囊与底部空间格的右键菜单、侧栏工作区行
// 的 ⋯ 菜单）——它们指的都是同一个项目文件夹，各写一份会立刻分叉（措辞/能力对不上）。
// 菜单容器沿用全站的 .ctx-menu/.ctx-item 配方（材质见 UI-SPEC §2.2bis）；行首不带图标
// （UI-SPEC §3.3 右键菜单定稿：动作以文字表达，危险项只用红色）。

/** 重命名 / 删除工作区（工作区生命周期动作）。
 *  原实现住在 Sidebar（⋯ 菜单专用）；三处入口共用菜单后搬来这里，逐字保留
 *  行为：重命名 = promptDialog + workspaceRename + refresh；删除 = 危险确认 +
 *  workspaceDelete + （删的是当前空间）落到第一个剩余空间 + refresh。 */
function useWorkspaceActions(ws: WorkspaceView, onDone: () => void) {
  const store = useStore();
  const { t, tt } = useT();
  const rename = () => {
    onDone();
    void (async () => {
      const title = await promptDialog({ title: t("重命名"), initialValue: ws.title });
      if (!title || !title.trim()) return;
      try { await api.workspaceRename({ workspaceId: ws.workspaceId, title: title.trim() }); await store.refresh(); }
      catch (err) { void alertDialog({ message: tt(`重命名失败：${(err as Error).message}`, `Rename failed: ${(err as Error).message}`) }); }
    })();
  };
  const remove = () => {
    onDone();
    void (async () => {
      const ok = await confirmDialog({ message: tt(`删除工作空间「${ws.title}」？\n（只解除项目归属，磁盘上的文件夹不会被删除）`, `Delete workspace “${ws.title}”?\n(Only detaches the project; files on disk and sessions are kept)`), danger: true });
      if (!ok) return;
      try {
        await api.workspaceDelete({ workspaceId: ws.workspaceId });
        clearWsIcon(ws.workspaceId); // glyph 存 localStorage（wsIcons），随删清理
        const rest = store.workspaces.filter((w) => w.workspaceId !== ws.workspaceId);
        if (store.activeWorkspaceId === ws.workspaceId && rest[0]) store.switchWorkspace(rest[0].workspaceId);
        await store.refresh();
      } catch (err) { void alertDialog({ message: tt(`删除失败：${(err as Error).message}`, `Delete failed: ${(err as Error).message}`) }); }
    })();
  };
  return { rename, remove };
}

/** 项目完整菜单：文件夹动作 + 生命周期动作。三处入口（hero 胶囊、底部空间格、
 *  侧栏工作区行 ⋯）共用这一份，不再出现「这里能删那里不能删」。iconAt 是项目
 *  元素上的一个点（右键落点/⋯按钮位）：「修改图标」的选择器贴它弹出——用菜单行
 *  自己的点击坐标会随菜单位置漂移，锚项目元素三处入口才都落对。 */
export function WorkspaceMenuItems({ ws, onDone, iconAt }: { ws: WorkspaceView; onDone: () => void; iconAt: { x: number; y: number } }) {
  const { t } = useT();
  const { rename, remove } = useWorkspaceActions(ws, onDone);
  return (
    <>
      <div className="ctx-item" onClick={() => { revealPath(ws.path); onDone(); }}>
        {t("在 Finder 中打开")}
      </div>
      <div className="ctx-item" onClick={() => {
        // 与会话右键菜单同一条复制路径（navigator.clipboard）。手机浏览器上
        // 可能因权限静默失败——那是既有限制，不在本轮扩大范围。
        void navigator.clipboard.writeText(ws.path).catch(() => void 0);
        onDone();
      }}>
        {t("复制路径")}
      </div>
      <div className="ctx-sep" />
      {/* 编辑项目：唤出编辑弹窗（复用新建项目表单，改名称/图标/项目指令） */}
      <div className="ctx-item" onClick={() => { openEditProjectDialog(ws); onDone(); }}>
        {t("编辑项目")}
      </div>
      <div className="ctx-item" onClick={rename}>
        {t("重命名")}
      </div>
      {/* 修改图标：坐标锚定的图标选择器（IconPickerHost 挂 App 根部，不随
          本菜单卸载），锚点取项目元素上的 iconAt；选「默认」即清除 glyph
          回落首字母/约定文件 */}
      <div className="ctx-item" onClick={() => {
        openIconPickerAt({
          x: iconAt.x, y: iconAt.y,
          value: getWsIcon(ws.workspaceId),
          label: ws.title,
          onChange: (v) => { if (v) setWsIcon(ws.workspaceId, v); else clearWsIcon(ws.workspaceId); },
        });
        onDone();
      }}>
        {t("修改图标")}
      </div>
      <div className="ctx-item danger" onClick={remove}>
        {t("删除工作区")}
      </div>
    </>
  );
}

/** 菜单的宽与高：`.ctx-menu` 的 min-width 190 是地板，内容（五个动作项 + 两条分隔）
 *  撑不到更宽——留 228 是为了给"以后加长文案"余量。高度是估值（限高另有实测余量兜）。 */
const CTX_MENU_WIDTH = 228;
const CTX_MENU_HEIGHT = 240;

/** 项目元素的右键菜单（胶囊 / 空间格）：位置取右键坐标。
 *  click-outside 关闭与 ModelMenu/ProjectMenu 同款（mousedown + ref）。
 *  传送到 body 渲染：空间格在侧栏最底部，菜单留在侧栏里会被 overflow 裁掉
 *  （用户报「下方项目的右键都看不到了」）；空间不够向下就向上翻。 */
export function WorkspaceMenu({ ws, x, y, onClose }: { ws: WorkspaceView; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);

  // 锚点就是右键那一点（没有触发器元素）：落位算术与全站同一份。
  // 尺寸用估值——限高由浮层模块按**实际余量**再压一次，所以估大了也不会出视口。
  const pos = placeFloating(
    { top: y, bottom: y, left: x, right: x, width: 0 },
    { width: CTX_MENU_WIDTH, height: CTX_MENU_HEIGHT },
  );

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      style={{
        position: "fixed",
        top: pos.top,
        bottom: "auto",
        left: pos.left,
        right: "auto",
        maxHeight: pos.maxHeight,
        overflowY: "auto",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <GlassLayer />
      <WorkspaceMenuItems ws={ws} onDone={onClose} iconAt={{ x, y }} />
    </div>,
    document.body,
  );
}
