// 文件预览窗口（产物/文件 chip 打开）：little 浮窗与全屏页两态。
// little 态经 Portal 挂 body——整窗蒙版 + 模糊压住，浮窗居中，窗外右缘挂
// 悬浮控制簇（关闭 / 全屏 / 默认应用打开 / Finder 定位），一律作用于当前
// 活动标签。
// 全屏态是"打开成的新页面"：由 SessionView 内联挂载，页面自带页头
// （返回钮 + 取文件名作标题 + 右上的「打开方式」选择器），材质沿用会话面板
// （不另铺实心/玻璃面），消息流与输入框让位。
// 本模块只管呈现：标签/全屏状态在 useFilePreview。

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronLeft, ExternalLink, FolderSearch, Maximize2, Minimize2, WrapText, X } from "lucide-react";
import { t } from "../../i18n";
import { openPath, revealPath } from "../../host";
import { PreviewBody } from "./PreviewBody";
import { OpenWithMenu } from "./OpenWithMenu";
import { renderersOf, supportsWrap, titleOf, type PreviewRenderer } from "./previewModel";
import { rendererOf, wrapOf, type FilePreview, type PreviewTab } from "./useFilePreview";

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

/** 视图控制簇（标签行右端 / 全屏页头右侧）：渲染器下拉 + 换行开关。
 *  渲染器候选来自 previewModel（多命中可切，纯文本恒兜底）；换行只在当前
 *  渲染器声明 wrap 时出现（官方同款：code / text）。 */
function ViewControls({ preview, active }: { preview: FilePreview; active: PreviewTab }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = rendererOf(active);
  const candidates = renderersOf(active.path);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (renderer: PreviewRenderer) => {
    setOpen(false);
    preview.setRenderer(renderer);
  };

  return (
    <span className="preview-view">
      <button
        ref={triggerRef}
        type="button"
        className="preview-view-btn"
        aria-label={t("预览方式")}
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            const r = triggerRef.current?.getBoundingClientRect();
            if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
          }
          setOpen((o) => !o);
        }}
      >
        {titleOf(current)}
        <ChevronDown size={12} />
      </button>
      {supportsWrap(current) && (
        <button
          type="button"
          className="preview-view-btn"
          data-on={wrapOf(active) ? "" : undefined}
          data-tip={t("折行")}
          aria-label={t("折行")}
          aria-pressed={wrapOf(active)}
          onClick={() => preview.toggleWrap()}
        >
          <WrapText size={14} />
        </button>
      )}
      {open && pos && createPortal(
        <div ref={menuRef} className="ctx-menu preview-view-menu" role="listbox" aria-label={t("预览方式")}
          style={{ position: "fixed", top: pos.top, right: pos.right }}>
          {candidates.map((r) => (
            <button
              key={r}
              type="button"
              role="option"
              aria-selected={r === current}
              className="ctx-item preview-view-item"
              onClick={() => pick(r)}
            >
              <span className="preview-view-name">{titleOf(r)}</span>
              {r === current && <Check size={14} className="open-with-check" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
}

/** 窗口内容：little 态 = 标签条（含视图控制簇）+ 预览体；全屏态（withTabs
 *  false）只出预览体——全屏的 chrome 归 PreviewPageHeader，再挂一条标签条
 *  就是同一套控件画两遍，且两处都贴顶（真机上标题与标签互相压字）。 */
function PreviewContent({ preview, withTabs = true }: { preview: FilePreview; withTabs?: boolean }) {
  const { tabs, activePath, setActive, close } = preview;
  const active = activeTab(preview);
  return (
    <>
      {withTabs && (
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
          {active && <ViewControls preview={preview} active={active} />}
        </div>
      )}
      <div className="preview-clip">
        {active && (
          <PreviewBody
            key={active.path}
            path={active.path}
            renderer={rendererOf(active)}
            wrap={wrapOf(active)}
            line={active.line}
            page={active.page}
            onPage={preview.setPage}
            onOpenFile={preview.open}
          />
        )}
      </div>
    </>
  );
}

/** 全屏态：取代会话界面（SessionView 内联挂载在会话体上）。页头（返回 +
 *  文件名 + 视图控制 + 打开方式）由 PreviewPageHeader 出，这里只出预览体。 */
export function FilePreviewSurface({ preview }: { preview: FilePreview }) {
  useEscapeBack(preview);
  return (
    <div className="preview-surface">
      <PreviewContent preview={preview} withTabs={false} />
    </div>
  );
}

/** 全屏页的页头：返回钮 + 文件名 + 视图切换（贴标题右侧，与标题同一行）+
 *  右端「打开方式」。与 .session-header 同一套几何（红线/标题行对齐），
 *  但不带模型选择与状态胶囊——全屏后这就是另一个页面。 */
export function PreviewPageHeader({ preview }: { preview: FilePreview }) {
  const active = activeTab(preview);
  if (!active) return null;
  return (
    <div className="session-header preview-page-head">
      <div className="left">
        <div className="title-row">
          <button
            type="button"
            className="session-back"
            data-tip={t("返回")}
            aria-label={t("返回")}
            onClick={() => preview.setFullscreen(false)}
          >
            <ChevronLeft size={15} />
          </button>
          <div className="title">{active.name}</div>
          <ViewControls preview={preview} active={active} />
        </div>
      </div>
      <OpenWithMenu path={active.path} />
    </div>
  );
}

/** little 态：整窗蒙版 + 模糊，浮窗居中；点蒙版空白处关闭。
 *  浮窗是蒙版的**兄弟**而非子元素：蒙版自带 backdrop-filter 会成为 backdrop
 *  root，子层磨砂只能取到蒙版自身绘制（=形同没磨砂，同 .composer-anchor 那条
 *  教训）；同为 body 下的兄弟，浮窗才能磨到"蒙版 + 应用内容"。 */
export function FilePreviewOverlay({ preview }: { preview: FilePreview }) {
  useEscapeBack(preview);
  return createPortal(
    <>
      <div
        className="preview-veil"
        // 点空白关闭用 mousedown + target 判定（PITFALLS §1.7：React 事件沿组件树
        // 冒泡，弹层内的点击会路过遮罩，用 click 会误关）
        onMouseDown={(e) => { if (e.target === e.currentTarget) preview.closeAll(); }}
      />
      <div className="preview-window" role="dialog" aria-label={t("文件预览")}>
        <PreviewContent preview={preview} />
        <PreviewControls preview={preview} />
      </div>
    </>,
    document.body,
  );
}
