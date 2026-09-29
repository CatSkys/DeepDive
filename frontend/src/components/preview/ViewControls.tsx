// 预览面板的视图控制簇：渲染器下拉 + 折行开关。挂点两处（标签行右端 / 全屏页头
// 标题行），候选来自 previewModel（多命中可切，纯文本恒兜底）；换行只在当前
// 渲染器声明 wrap 时出现（官方同款：code / text）。菜单挂 body：面板正文是滚动
// 容器，行内或绝对定位的下拉会被裁掉。

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, WrapText } from "lucide-react";
import { t } from "../../i18n";
import { renderersOf, supportsWrap, titleOf, type PreviewRenderer } from "./previewModel";
import { rendererOf, wrapOf, type FilePreview, type PreviewTab } from "./useFilePreview";

/** 视图控制簇（标签行右端 / 全屏页头右侧）：渲染器下拉 + 换行开关。
 *  渲染器候选来自 previewModel（多命中可切，纯文本恒兜底）；换行只在当前
 *  渲染器声明 wrap 时出现（官方同款：code / text）。 */
export function ViewControls({ preview, active }: { preview: FilePreview; active: PreviewTab }) {
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
