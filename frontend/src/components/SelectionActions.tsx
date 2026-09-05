import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import { DD_EVENTS } from "../events";

// 文字选择动作（用户定稿，参考 Raycast 选中弹窗）：消息流内选中文字 →
// 选区上方浮出 [添加到当前任务][复制]；右键（非输入框）→ 仅[复制]的自定义
// 菜单，并全程压掉 WKWebView 原生菜单（刷新/查找不需要）。输入框/文本域
// 不拦截：原生编辑菜单（粘贴/纠错）保留。
// portal 到 body + fixed 定位：flow 内层叠上下文密集（isolation/动画），
// 贴身定位会被吞（.model-menu 同款教训）。

interface FloatState { x: number; y: number; text: string }

/** 非折叠且落在消息流内的选区文字；无则 null。 */
function selectionInFlow(): string | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  const node = sel.anchorNode;
  const el = node ? (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement) : null;
  if (!el?.closest(".flow")) return null;
  return text;
}

export function SelectionActions() {
  const [popup, setPopup] = useState<FloatState | null>(null);
  const [menu, setMenu] = useState<FloatState | null>(null);

  useEffect(() => {
    const BAR = 40; // 浮条估高 + 间距：定位在其选区上方
    const close = () => { setPopup(null); setMenu(null); };
    const insideSelf = (e: MouseEvent) =>
      (e.target as Element | null)?.closest?.(".sel-actions") != null;

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0 || insideSelf(e)) return;
      const text = selectionInFlow();
      if (!text) { setPopup(null); return; }
      const sel = window.getSelection()!;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      // 选区中点上方，左右钳进视口（浮条 ~190px 宽，取半宽 95）
      const x = Math.min(Math.max(r.left + r.width / 2, 104), window.innerWidth - 104);
      setMenu(null);
      setPopup({ x, y: Math.max(8, r.top - BAR), text });
    };
    const onSelectionChange = () => {
      if (window.getSelection()?.isCollapsed) setPopup(null);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!insideSelf(e)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    // 滚动后选区锚点漂移：直接收起（比追踪重排便宜且不打扰）
    const onScroll = () => setPopup(null);
    const onContext = (e: MouseEvent) => {
      const target = e.target as Element | null;
      // 输入/可编辑区保留原生菜单（粘贴、纠错、候选词）
      if (target?.closest?.("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      close();
      const text = selectionInFlow();
      if (text) setMenu({ x: e.clientX, y: e.clientY, text });
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("contextmenu", onContext);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("contextmenu", onContext);
    };
  }, []);

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* 剪贴板不可用（权限/焦点缺失）：跳过反馈 */ }
    close();
  };
  const appendToComposer = (text: string) => {
    window.dispatchEvent(new CustomEvent(DD_EVENTS.composerAppend, { detail: { text } }));
    const sel = window.getSelection();
    sel?.removeAllRanges();
    close();
  };

  // 两个浮层共用一套浮条样式，按钮集不同；右键菜单只带[复制]
  const bar = (s: FloatState, buttons: React.ReactNode) =>
    createPortal(
      <div className="sel-actions" style={{ left: s.x, top: s.y }}>
        {buttons}
      </div>,
      document.body,
    );

  if (popup) {
    return bar(popup, (
      <>
        <button onClick={() => appendToComposer(popup.text)}>{t("添加到当前任务")}</button>
        <button onClick={() => void copy(popup.text)}>{t("复制")}</button>
      </>
    ));
  }
  if (menu) {
    return bar(menu, <button onClick={() => void copy(menu.text)}>{t("复制")}</button>);
  }
  return null;
}
