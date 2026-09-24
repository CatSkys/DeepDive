// 会话右侧边栏的面板本体（移植官方 ui-sidebar-right 的 client/shell/SidebarRight.tsx +
// RightbarRoot.tsx 的产品绑定部分，按用户定稿裁剪成"单列 + 三个页 + 设置视图"）。
//
// 官方规则逐条保留：面板是页面的一列（用会话的底色与字号，不是一张浮起来的卡片）、
// 没有标题行（控件骑在顶条最右端）、每会话一份内存态、无会话则无面板、两种呈现
// （push 让位 / fullscreen 盖住整卡）。
//
// 浏览器那一层**始终挂载**（切页只是换尺寸/隐藏）：载体只允许有一个实例——壳里只有一个
// WKWebView，而 iframe 载体重挂会丢页面状态。官方对应的是 Electron 载体的 keepMounted。

import { useState } from "react";
import { ChevronLeft, Settings2, Maximize2, Minimize2, X, Compass } from "lucide-react";
import { t } from "../i18n";
import { dispatchAppEvent, DD_EVENTS } from "../events";
import { usePanelSurface, panelActions } from "./panelStore";
import { PANEL_VIEWS, defaultView, guideEntries } from "./viewRegistry";
import { BrowserPane } from "./BrowserPane";
import { StatusSections } from "./StatusSections";
import { SessionSettings, type PermissionSelect } from "./SessionSettings";
import { useCapsuleData } from "./useCapsuleData";
import type { ArtifactItem } from "./sessionArtifacts";
import type { ModelFace } from "../session/SessionHeader";
import type { ScheduleRecord } from "../types";

export function SessionPanel({ sessionId, scheduleRecords, artifacts, face, permissions, onPreview }: {
  sessionId: string;
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

  const fallback = defaultView();
  const active = surface.tabs.find((tab) => tab.id === surface.activeId);
  const kind = active?.kind ?? fallback.kind;
  const fullscreen = surface.fullscreen;

  const openBrowser = () => {
    panelActions.openTab(sessionId, "browser", PANEL_VIEWS.find((v) => v.kind === "browser")!.title);
    panelActions.setFullscreen(sessionId, true);
  };

  return (
    <aside className="panel" data-fullscreen={fullscreen ? "true" : undefined} data-view={settingsOpen ? "settings" : kind}>
      <div className="panel-head">
        {settingsOpen ? (
          <button type="button" className="panel-icon-btn" aria-label={t("返回")} data-tip={t("返回")}
            onClick={() => setSettingsOpen(false)}>
            <ChevronLeft size={15} />
          </button>
        ) : (
          <div className="panel-tabs">
            {PANEL_VIEWS.map((view) => (
              <button
                key={view.id}
                type="button"
                className={`panel-tab${view.kind === kind ? " active" : ""}`}
                onClick={() => {
                  if (view.kind === "guide") panelActions.openTab(sessionId, "guide", view.title);
                  else if (view.kind === "browser") openBrowser();
                  else panelActions.showDefault(sessionId);
                }}
              >
                {t(view.title)}
              </button>
            ))}
          </div>
        )}
        <div className="panel-controls">
          <button type="button" className="panel-icon-btn" aria-label={t("会话设置")} data-tip={t("会话设置")}
            onClick={() => setSettingsOpen(true)}>
            <Settings2 size={14} />
          </button>
          <button
            type="button"
            className="panel-icon-btn"
            aria-label={fullscreen ? t("退出全屏") : t("全屏")}
            data-tip={fullscreen ? t("退出全屏") : t("全屏")}
            onClick={() => panelActions.setFullscreen(sessionId, !fullscreen)}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button type="button" className="panel-icon-btn" aria-label={t("收起")} data-tip={t("收起")}
            onClick={() => panelActions.setOpen(sessionId, false)}>
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="panel-body">
        {settingsOpen ? (
          <SessionSettings
            sessionId={sessionId}
            face={face}
            permissions={permissions}
            onBack={() => setSettingsOpen(false)}
            onOpenPlugins={() => dispatchAppEvent(DD_EVENTS.openSettings, { section: "plugins" })}
          />
        ) : (
          <>
            <div className="panel-browser-layer" data-hidden={kind === "guide" ? "true" : undefined}>
              <BrowserPane
                expanded={kind === "browser"}
                applicationOrigin={window.location.origin}
                onExpand={openBrowser}
              />
            </div>
            {kind === "status" && (
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
            {kind === "guide" && (
              <div className="panel-content">
                <div className="panel-guide">
                  <Compass size={20} className="panel-guide-glyph" aria-hidden="true" />
                  {guideEntries().map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className="panel-guide-entry"
                      onClick={() => {
                        if (entry.kind === "browser") openBrowser();
                        else panelActions.showDefault(sessionId);
                      }}
                    >
                      <span className="panel-guide-name">{t(entry.guide!.title)}</span>
                      <span className="panel-guide-desc">{t(entry.guide!.description)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
