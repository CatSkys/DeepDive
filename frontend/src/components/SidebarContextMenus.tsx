// 侧栏的两处右键/长按菜单：会话行菜单与项目行菜单。
// 单独成文件是因为它们只是菜单项的声明，没有状态机——留在 Sidebar 里只会把那个
// 文件撑大。两处都用 .ctx-menu 绝对定位于 pointer 坐标，随手在 window click 关掉。
import { useEffect } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";
import { api } from "../api";
import { sendToShell } from "../host";
import { alertDialog, confirmDialog, promptDialog } from "./DialogHost";
import { WorkspaceMenuItems } from "./WorkspaceMenu";
import { titleHidesSession } from "../session/backgroundSession";
import type { SessionSummary } from "../types";

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
  onOpenSettings: () => void;
}) {
  const store = useStore();
  const { t, tt } = useT();
  const activeWs = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId);

  useEffect(() => {
    if (!row && !workspaceAt) return;
    const close = () => onClose();
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [row, workspaceAt, onClose]);

  return (
    <>
      {workspaceAt && activeWs && (
        <div className="ctx-menu" style={{ top: workspaceAt.y, left: Math.min(workspaceAt.x, window.innerWidth - 200) }} onClick={(e) => e.stopPropagation()}>
          {/* 与 hero 胶囊 / 空间格的右键菜单同一份（五项全量） */}
          <WorkspaceMenuItems ws={activeWs} onDone={onClose} />
        </div>
      )}
      {row && (
        <div className="ctx-menu" style={{ top: row.y, left: Math.min(row.x, window.innerWidth - 220) }} onClick={(e) => e.stopPropagation()}>
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
          <div className="ctx-item" onClick={() => { onClose(); onOpenSettings(); }}>{t("前往配置")}</div>
        </div>
      )}
    </>
  );
}

/** 会话行菜单的落点：右键与触屏长按共用（longPressHandlers 传的就是屏幕坐标）。 */
export function rowMenuAt(s: SessionSummary, title: string, x: number, y: number): RowMenuState {
  return { sessionId: s.sessionId, title, cwd: s.cwd, x, y };
}
