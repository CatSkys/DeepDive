// 预览面板的视图控制簇：渲染器下拉 + 折行开关。挂点两处（标签行右端 / 全屏页头
// 标题行），候选来自 previewModel（多命中可切，纯文本恒兜底）；换行只在当前
// 渲染器声明 wrap 时出现（官方同款：code / text）。菜单挂 body：面板正文是滚动
// 容器，行内或绝对定位的下拉会被裁掉。

import { useRef, useState } from "react";
import { Check, ChevronDown, WrapText } from "lucide-react";
import { t } from "../../i18n";
import { renderersOf, supportsWrap, titleOf, type PreviewRenderer } from "./previewModel";
import { rendererOf, wrapOf, type FilePreview, type PreviewTab } from "./useFilePreview";
import { Popover } from "../Popover";

/** 视图控制簇（标签行右端 / 全屏页头右侧）：渲染器下拉 + 换行开关。
 *  渲染器候选来自 previewModel（多命中可切，纯文本恒兜底）；换行只在当前
 *  渲染器声明 wrap 时出现（官方同款：code / text）。 */
export function ViewControls({ preview, active }: { preview: FilePreview; active: PreviewTab }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = rendererOf(active);
  const candidates = renderersOf(active.path);

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
        onClick={() => setOpen((o) => !o)}
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
      <Popover
        open={open}
        anchor={triggerRef}
        onClose={() => setOpen(false)}
        sideOffset={4}
        align="end"
        className="ctx-menu preview-view-menu"
        role="listbox"
        aria-label={t("预览方式")}
      >
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
      </Popover>
    </span>
  );
}
