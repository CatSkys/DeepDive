// 会话右侧边栏的面板本体（移植官方 ui-sidebar-right 的 client/shell/SidebarRight.tsx +
// RightbarRoot.tsx 的产品绑定部分）。
//
// 形状按用户定稿与参考图：**右上角只有齿轮与关闭**，下面是带圆角的屏幕缩略图，
// 再下面才是能力分区。点缩略图 → 浏览器页（工具栏 + 整页）并进全屏呈现；
// 齿轮 → 面板内切到会话设置。
//
// 官方规则逐条保留：没有标题行（控件骑在顶条最右端）、每会话一份内存态、无会话则无面板、
// 两种呈现（push 让位 / fullscreen 盖住整卡）。**官方"面板是页面的一列"这条本仓不照抄**：
// 用户定稿改成会话列与面板两张并列的悬浮卡（几何见 theme.css 的 .session-row 一段）。
//
// 浏览器那一层**始终挂载**（切页只换尺寸）：载体只允许有一个实例——壳里只有一个
// WKWebView，而 iframe 载体重挂会丢页面状态。官方对应的是 Electron 载体的 keepMounted。

import { ChevronLeft, Settings2, X } from "lucide-react";
import { t } from "../i18n";
import { dispatchAppEvent, DD_EVENTS } from "../events";
import { usePanelSurface, panelActions } from "./panelStore";
import { BrowserPane } from "./BrowserPane";
import { toggleChatFloat } from "./useComposerOverlay";
import { StatusSections } from "./StatusSections";
import { SessionSettings } from "./SessionSettings";
import { useCapsuleData } from "./useCapsuleData";
import type { ArtifactItem } from "./sessionArtifacts";
import type { PermissionSelect } from "../settings/permissionPreset";
import type { ModelFace } from "../session/SessionHeader";
import type { ScheduleRecord } from "../types";

export function SessionPanel({ sessionId, scheduleRecords, artifacts, face, agentPreset, permissions, onPreview, onOpenReview }: {
  sessionId: string;
  scheduleRecords: ScheduleRecord[];
  artifacts: ArtifactItem[];
  face: ModelFace;
  /** 当前会话 pin 的 agent preset id（summary 投影；透传给会话设置的模式行）。 */
  agentPreset?: string;
  permissions: PermissionSelect | null;
  onPreview?: (path: string) => void;
  /** 开审查面板（状态胶囊 Git 区的「更改」行走这里）。 */
  onOpenReview?: () => void;
}) {
  const surface = usePanelSurface(sessionId);
  const data = useCapsuleData(sessionId, scheduleRecords, surface.open && !surface.settings);
  // 卡片常驻、只切收起态（data-closed）：开合是 CSS transition，与左边栏同一语言；
  // 收起时正文不挂——浏览器那层是壳按 rect 摆的原生 WKWebView 槽位，挂不挂仍由开合决定。
  if (!surface.open) return <aside className="panel" data-closed="true" />;

  const settingsOpen = surface.settings;
  const browserMode = surface.mode === "browser";
  const back = () => {
    if (settingsOpen) panelActions.setSettings(sessionId, false);
    else panelActions.showSession(sessionId);
  };

  return (
    <aside className="panel" data-fullscreen={surface.fullscreen ? "true" : undefined} data-mode={browserMode ? "browser" : "session"}>
      {/* 浏览器页不放头部那排（用户定稿：两排并一排）：收起那枚变成「退出全屏」，进了标签行行尾 */}
      {!browserMode && (
      <div className="panel-head">
        {(settingsOpen || browserMode) && (
          <button type="button" className="panel-icon-btn" aria-label={t("返回")} data-tip={t("返回")} onClick={back}>
            <ChevronLeft size={15} />
          </button>
        )}
        {settingsOpen && <span className="panel-head-title">{t("会话设置")}</span>}
        <div className="panel-controls">
          {/* 浏览器页（含全屏）不放"会话设置"：那一页要看的是网页，设置页会把整格换掉。
            「对话」不在这儿——它在地址栏右侧（见 BrowserToolbar）。 */}
          {!browserMode && !settingsOpen && (
            <button type="button" className="panel-icon-btn" aria-label={t("会话设置")} data-tip={t("会话设置")}
              onClick={() => panelActions.setSettings(sessionId, true)}>
              <Settings2 size={15} />
            </button>
          )}
          <button type="button" className="panel-icon-btn" aria-label={t("收起")} data-tip={t("收起")}
            onClick={() => panelActions.setOpen(sessionId, false)}>
            <X size={15} />
          </button>
        </div>
      </div>
      )}

      <div className="panel-body">
        {settingsOpen ? (
          <SessionSettings
            sessionId={sessionId}
            face={face}
            agentPreset={agentPreset}
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
                onExitFullscreen={() => { panelActions.setFullscreen(sessionId, false); panelActions.showSession(sessionId); }}
                onChat={() => toggleChatFloat(sessionId)}
                onTabsRespawned={() => { if (surface.mode === "browser") panelActions.showSession(sessionId); }}
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
                  onOpenReview={onOpenReview}
                />
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
