// 文件预览窗口（产物/文件 chip 打开）：little 浮窗与全屏两态。
// little 态经 Portal 挂 body——整窗蒙版 + 模糊压住，浮窗居中，窗外右缘挂
// 悬浮控制簇（关闭 / 全屏 / 默认应用打开 / Finder 定位），一律作用于当前
// 活动标签；全屏态由 SessionView 内联挂载，取代会话界面（消息流与输入框
// 让位、头部留会话标题并加返回钮）。
// 窗内只有标签条 + 内容：不常显路径（标签 title 与「在 Finder 中显示」可及）。
// 本模块只管呈现：标签/全屏状态在 useFilePreview。

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, FolderSearch, Maximize2, Minimize2, X } from "lucide-react";
import { t } from "../../i18n";
import { openPath, revealPath } from "../../host";
import { PreviewBody } from "./PreviewBody";
import type { FilePreview, PreviewTab } from "./useFilePreview";

/** 当前活动标签（标签集非空时）。 */
function activeTab(preview: FilePreview): PreviewTab | undefined {
  return preview.tabs.find((x) => x.path === preview.activePath) ?? preview.tabs[preview.tabs.length - 1];
}

/** Esc 退一层：全屏回 little 窗，little 窗关掉预览。灯箱（预览内点图放大）
 *  在场时让位——Esc 先关最上层的那一个。 */
function useEscapeBack(preview: FilePreview) {
  const { fullscreen, setFullscreen, closeAll } = preview;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".lightbox")) return;
      if (fullscreen) setFullscreen(false);
      else closeAll();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fullscreen, setFullscreen, closeAll]);
}

/** 悬浮控制簇（窗外右缘 / 全屏面右上角）：关闭 · 全屏 · 默认应用打开 ·
 *  在 Finder 中显示。配色不随主题——叠在任意内容上，与 lightbox 关闭钮同语言。 */
function PreviewControls({ preview }: { preview: FilePreview }) {
  const active = activeTab(preview);
  if (!active) return null;
  const full = preview.fullscreen;
  return (
    <div className="preview-controls">
      <button
        type="button"
        className="preview-control"
        data-tip={t("关闭预览")}
        aria-label={t("关闭预览")}
        onClick={preview.closeAll}
      >
        <X size={17} />
      </button>
      <button
        type="button"
        className="preview-control"
        data-tip={full ? t("退出全屏") : t("全屏预览")}
        aria-label={full ? t("退出全屏") : t("全屏预览")}
        onClick={() => preview.setFullscreen(!full)}
      >
        {full ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
      </button>
      <button
        type="button"
        className="preview-control"
        data-tip={t("默认应用打开")}
        aria-label={t("默认应用打开")}
        onClick={() => openPath(active.path)}
      >
        <ExternalLink size={16} />
      </button>
      <button
        type="button"
        className="preview-control"
        data-tip={t("在 Finder 中显示")}
        aria-label={t("在 Finder 中显示")}
        onClick={() => revealPath(active.path)}
      >
        <FolderSearch size={16} />
      </button>
    </div>
  );
}

/** 窗口内容（两态共用）：标签条 + 活动标签的预览体。 */
function PreviewContent({ preview }: { preview: FilePreview }) {
  const { tabs, activePath, setActive, close } = preview;
  const active = activeTab(preview);
  return (
    <>
      <div className="preview-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.path}
            type="button"
            role="tab"
            aria-selected={tab.path === activePath}
            className="preview-tab"
            data-active={tab.path === activePath || undefined}
            title={tab.path}
            onClick={() => setActive(tab.path)}
          >
            <span className="preview-tab-name">{tab.name}</span>
            <span
              className="preview-tab-x"
              role="button"
              aria-label={t("关闭预览")}
              onClick={(e) => { e.stopPropagation(); close(tab.path); }}
            >
              <X size={11} />
            </span>
          </button>
        ))}
      </div>
      <div className="preview-clip">
        {active && <PreviewBody key={active.path} path={active.path} />}
      </div>
    </>
  );
}

/** 全屏态：取代会话界面（SessionView 内联挂载在会话体上）。 */
export function FilePreviewSurface({ preview }: { preview: FilePreview }) {
  useEscapeBack(preview);
  return (
    <div className="preview-surface" role="dialog" aria-label={t("文件预览")}>
      <PreviewContent preview={preview} />
      <PreviewControls preview={preview} />
    </div>
  );
}

/** little 态：整窗蒙版 + 模糊，浮窗居中；点蒙版空白处关闭。 */
export function FilePreviewOverlay({ preview }: { preview: FilePreview }) {
  useEscapeBack(preview);
  return createPortal(
    <div
      className="preview-veil"
      // 点空白关闭用 mousedown + target 判定（PITFALLS §1.7：React 事件沿组件树
      // 冒泡，弹层内的点击会路过遮罩，用 click 会误关）
      onMouseDown={(e) => { if (e.target === e.currentTarget) preview.closeAll(); }}
    >
      <div className="preview-window" role="dialog" aria-label={t("文件预览")}>
        <PreviewContent preview={preview} />
        <PreviewControls preview={preview} />
      </div>
    </div>,
    document.body,
  );
}
