// 会话右侧边栏的面板本体（移植官方 ui-sidebar-right 的 client/shell/SidebarRight.tsx +
// RightbarRoot.tsx 的产品绑定部分）。
//
// 形状按用户定稿与参考图：**右上角只有齿轮与关闭**，下面是带圆角的屏幕缩略图 + 一行
// 居中说明，再下面才是能力分区。点缩略图 → 浏览器页（工具栏 + 整页）并进全屏呈现；
// 齿轮 → 面板内切到会话设置。
//
// 官方规则逐条保留：没有标题行（控件骑在顶条最右端）、每会话一份内存态、无会话则无面板、
// 两种呈现（push 让位 / fullscreen 盖住整卡）。**官方"面板是页面的一列"这条本仓不照抄**：
// 用户定稿改成会话列与面板两张并列的悬浮卡（几何见 theme.css 的 .session-row 一段）。
//
// 浏览器那一层**始终挂载**（切页只换尺寸）：载体只允许有一个实例——壳里只有一个
// WKWebView，而 iframe 载体重挂会丢页面状态。官方对应的是 Electron 载体的 keepMounted。

import { useState } from "react";
import { ChevronLeft, Settings2, X } from "lucide-react";
import { t, tt } from "../i18n";
import { dispatchAppEvent, DD_EVENTS } from "../events";
import { usePanelSurface, panelActions } from "./panelStore";
import { BrowserPane } from "./BrowserPane";
import { StatusSections } from "./StatusSections";
import { SessionSettings } from "./SessionSettings";
import { useCapsuleData } from "./useCapsuleData";
import type { ArtifactItem } from "./sessionArtifacts";
import type { PermissionSelect } from "../settings/permissionPreset";
import type { ModelFace } from "../session/SessionHeader";
import type { ScheduleRecord } from "../types";

export function SessionPanel({ sessionId, title, scheduleRecords, artifacts, face, permissions, onPreview }: {
  sessionId: string;
  /** 会话标题：屏幕缩略图的说明行用它（"<标题> 的屏幕"）。 */
  title: string;
  scheduleRecords: ScheduleRecord[];
  artifacts: ArtifactItem[];
  face: ModelFace;
  permissions: PermissionSelect | null;
  onPreview?: (path: string) => void;
}) {
  const surface = usePanelSurface(sessionId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const data = useCapsuleData(sessionId, scheduleRecords, surface.open && !settingsOpen);
  if (!surface.open) return null;

  const browserMode = surface.mode === "browser";
  const back = () => {
    if (settingsOpen) setSettingsOpen(false);
    else panelActions.showSession(sessionId);
  };

  return (
    <aside className="panel" data-fullscreen={surface.fullscreen ? "true" : undefined} data-mode={browserMode ? "browser" : "session"}>
      <div className="panel-head">
        {(settingsOpen || browserMode) && (
          <button type="button" className="panel-icon-btn" aria-label={t("返回")} data-tip={t("返回")} onClick={back}>
            <ChevronLeft size={15} />
          </button>
        )}
        {settingsOpen && <span className="panel-head-title">{t("会话设置")}</span>}
        <div className="panel-controls">
          {!settingsOpen && (
            <button type="button" className="panel-icon-btn" aria-label={t("会话设置")} data-tip={t("会话设置")}
              onClick={() => setSettingsOpen(true)}>
              <Settings2 size={15} />
            </button>
          )}
          <button type="button" className="panel-icon-btn" aria-label={t("收起")} data-tip={t("收起")}
            onClick={() => panelActions.setOpen(sessionId, false)}>
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="panel-body">
        {settingsOpen ? (
          <SessionSettings
            sessionId={sessionId}
            face={face}
            permissions={permissions}
            onOpenPlugins={() => dispatchAppEvent(DD_EVENTS.openSettings, { section: "plugins" })}
          />
        ) : (
          <>
            <div className="panel-browser-layer">
              <BrowserPane
                expanded={browserMode}
                applicationOrigin={window.location.origin}
                onExpand={() => panelActions.expandBrowser(sessionId)}
                caption={tt("{name}的屏幕", "{name}'s screen", { name: title })}
              />
            </div>
            {!browserMode && (
              <div className="panel-content">
                <StatusSections
                  sessionId={sessionId}
                  data={data}
                  scheduleRecords={scheduleRecords}
                  artifacts={artifacts}
                  onPreview={onPreview}
                />
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
