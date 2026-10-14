// 侧栏的两处右键/长按菜单：会话行菜单与项目行菜单。
// 单独成文件是因为它们只是菜单项的声明，没有状态机——留在 Sidebar 里只会把那个
// 文件撑大。两处都用 .ctx-menu 绝对定位于 pointer 坐标，随手在 window click 关掉。
import { useT } from "../i18n";
import { useStore } from "../store";
import { api } from "../api";
import { sendToShell } from "../host";
import { alertDialog, confirmDialog, promptDialog } from "./DialogHost";
import { WorkspaceMenuItems } from "./WorkspaceMenu";
import { titleHidesSession } from "../session/backgroundSession";
import type { SessionSummary } from "../types";
import { Popover } from "./Popover";

export interface RowMenuState {
  sessionId: string;
  title: string;
  cwd?: string;
  x: number;
  y: number;
}

export function SidebarContextMenus({
  row,
  workspaceAt,
  onClose,
  onOpenSettings,
}: {
  row: RowMenuState | null;
  /** 项目行 ⋯ 的落点；null = 不显示。 */
  workspaceAt: { x: number; y: number } | null;
  onClose: () => void;
  /** 「前往配置」的落点：主窗传（打开设置页）；迷你面板不传——它自己带设置入口，
   *  这项在那边没有落点。不给就不渲染这一项。 */
  onOpenSettings?: () => void;
}) {
  const store = useStore();
  const { t, tt } = useT();
  const activeWs = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId);

  return (
    <>
      {workspaceAt && activeWs && (
        <Popover
          open
          anchor={{ top: workspaceAt.y, bottom: workspaceAt.y, left: workspaceAt.x, right: workspaceAt.x, width: 0, height: 0 }}
          onClose={onClose}
          sideOffset={0}
          className="ctx-menu"
        >
          {/* 与 hero 胶囊 / 空间格的右键菜单同一份（五项全量）；iconAt 取 ⋯
              按钮落点——「修改图标」的选择器贴项目行弹 */}
          <WorkspaceMenuItems ws={activeWs} onDone={onClose} iconAt={workspaceAt} />
        </Popover>
      )}
      {row && (
        <Popover
          open
          anchor={{ top: row.y, bottom: row.y, left: row.x, right: row.x, width: 0, height: 0 }}
          onClose={onClose}
          sideOffset={0}
          className="ctx-menu"
        >
          <div className="ctx-item" onClick={() => {
            onClose();
            void promptDialog({ title: t("重命名任务"), initialValue: row.title }).then(async (title) => {
              if (!title || !title.trim()) return;
              const next = title.trim();
              // 列表可见性由标题前缀派生：改成一个后台会话的名字 = 它从列表里消失
              if (titleHidesSession(next)) {
                const ok = await confirmDialog({
                  title: t("重命名任务"),
                  message: t("这个名字以后台会话的保留前缀开头（自动化·／自进化·），改完这个会话会从列表里消失。确定吗？"),
                  confirmLabel: t("重命名"),
                });
                if (!ok) return;
              }
              try {
                await api.sessionRename({ sessionId: row.sessionId, title: next });
                await store.refresh();
              } catch (err) {
                void alertDialog({ message: tt(`重命名失败：${(err as Error).message}`, `Rename failed: ${(err as Error).message}`) });
              }
            });
          }}>{t("重命名任务")}</div>
          <div className="ctx-item" onClick={async () => {
            const err = await store.archiveSession(row.sessionId);
            if (err) void alertDialog({ message: tt("归档失败：{m}", "Archive failed: {m}", { m: err }) });
            onClose();
          }}>{t("归档任务")}</div>
          <div className="ctx-item" onClick={() => { store.markUnread(row.sessionId); onClose(); }}>{t("标记为未读")}</div>
          <div className="ctx-item" onClick={() => { store.togglePin(row.sessionId); onClose(); }}>
            {store.pinned.has(row.sessionId) ? t("取消置顶") : t("置顶")}
          </div>
          <div className="ctx-sep" />
          <div className="ctx-item" onClick={() => { sendToShell({ type: "reveal-path", path: row.cwd ?? "" }); onClose(); }}>{t("在 Finder 中打开")}</div>
          <div className="ctx-item" onClick={() => { if (row.cwd) navigator.clipboard.writeText(row.cwd); onClose(); }}>{t("复制路径")}</div>
          <div className="ctx-item" onClick={() => { sendToShell({ type: "copy-log-path" }); onClose(); }}>{t("复制日志路径")}</div>
          <div className="ctx-item" onClick={() => { navigator.clipboard.writeText(row.sessionId); onClose(); }}>{t("复制会话 ID")}</div>
          <div className="ctx-item danger" onClick={async () => {
            // 删除不可逆：先危险确认。引擎按 id 逐条回 refused（在跑/正开着 = busy），
            // 拒绝原因照实说——一句笼统的"删除失败"会让人以为点错了。
            const ok = await confirmDialog({
              title: t("删除会话"),
              message: t("删除后聊天记录、投影缓存与工作区记账一起清掉，无法恢复。确定吗？"),
              confirmLabel: t("删除"),
              danger: true,
            });
            if (!ok) return;
            onClose();
            const res = await store.removeSessions([row.sessionId]);
            const refused = res.refused[0];
            if (!refused) return;
            void alertDialog({
              message: refused.reason === "busy"
                ? t("正在运行或正开着的会话不能删除——先停掉它或切到别的会话")
                : tt("删除失败：{m}", "Delete failed: {m}", { m: refused.detail ?? refused.reason }),
            });
          }}>{t("删除")}</div>
          {onOpenSettings && <div className="ctx-item" onClick={() => { onClose(); onOpenSettings(); }}>{t("前往配置")}</div>}
        </Popover>
      )}
    </>
  );
}

/** 会话行菜单的落点：右键与触屏长按共用（longPressHandlers 传的就是屏幕坐标）。 */
export function rowMenuAt(s: SessionSummary, title: string, x: number, y: number): RowMenuState {
  return { sessionId: s.sessionId, title, cwd: s.cwd, x, y };
}
