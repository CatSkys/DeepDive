import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import { openPath, revealPath } from "../host";
import { DD_EVENTS } from "../events";

// 消息流右键菜单与选中浮条（用户定稿，参考 Raycast 选中弹窗）：选中文字 →
// 选区上方浮出 [添加到当前任务][复制]；右键（非输入框）→ 光标处的自定义菜单，
// 并全程压掉 WKWebView 原生菜单（刷新/查找不需要）——落在产物文件 chip
// （data-file-ctx=绝对路径，ToolRow 的 ProducedFiles 挂）上给 [默认应用打开]
// [在 Finder 中显示]，其余情况有选区就给 [复制]。输入框/文本域不拦截：
// 原生编辑菜单（粘贴/纠错）保留。
// portal 到 body + fixed 定位：flow 内层叠上下文密集（isolation/动画），
// 贴身定位会被吞（.model-menu 同款教训）。

/** 锚点：x=横向中心，above=浮条上沿该放哪（选区顶/光标点），below=放不下时翻到哪。 */
interface FloatState { x: number; above: number; below: number; text: string }
interface FileState { x: number; above: number; below: number; path: string }

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
  const [file, setFile] = useState<FileState | null>(null);
  /** 落点（按实测尺寸钳过一遍的结果）；锚点变了先置 null，等量完再摆。 */
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // 收起全部浮层。必须是组件级：渲染体里的按钮回调也只能用它——
  // 早先它只存在于 effect 内，那些 close() 其实调到全局 window.close()
  // （浮条点「复制」后不收起）。
  const close = useCallback(() => { setPopup(null); setMenu(null); setFile(null); setPos(null); }, []);

  // 落点钳位（用户报"浮条跑到卡外、又被裁掉"）：按浮条**实测**宽高落位，横向优先
  // 钳在消息流卡的内容区内（卡片 overflow 会裁掉越界的部分），锚点在卡外时才退回
  // 窗口；选区上方放不下就翻到下方。
  const anchor = popup ?? menu ?? file;
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!anchor || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    // 钳位基准取 .flow（滚动视口，位置固定在视口里）；不是 .flow-inner——
    // 那是滚动内容，内容滚出去时它的矩形也跟着跑到视口外，钳不住。
    const flow = (document.querySelector(".flow") ?? document.querySelector(".flow-inner"))?.getBoundingClientRect() ?? null;
    const anchorInFlow = flow != null && anchor.x >= flow.left && anchor.x <= flow.right;
    const box = anchorInFlow
      ? { left: flow!.left + 4, right: flow!.right - 4, top: flow!.top + 4, bottom: flow!.bottom - 4 }
      : { left: 8, right: window.innerWidth - 8, top: 8, bottom: window.innerHeight - 8 };
    const half = w / 2;
    const GAP = 8;
    const x = Math.min(Math.max(anchor.x, box.left + half), Math.max(box.left + half, box.right - half));
    let y = anchor.above - h - GAP;
    if (y < box.top) y = Math.min(anchor.below + GAP, box.bottom - h);
    setPos({ x, y: Math.max(box.top, Math.min(y, box.bottom - h)) });
  }, [anchor?.x, anchor?.above, anchor?.below, anchor != null]);

  useEffect(() => {
    const insideSelf = (e: MouseEvent) =>
      (e.target as Element | null)?.closest?.(".sel-actions") != null;

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0 || insideSelf(e)) return;
      const text = selectionInFlow();
      if (!text) { setPopup(null); return; }
      const sel = window.getSelection()!;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      setMenu(null);
      // 只给锚点，落点交给钳位 effect 按实测尺寸算
      setPopup({ x: r.left + r.width / 2, above: r.top, below: r.bottom, text });
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
      // 产物文件 chip：文件动作优先（光标就在 chip 上，选区语义让位）
      const chip = target?.closest?.("[data-file-ctx]")?.getAttribute("data-file-ctx");
      if (chip) { setFile({ x: e.clientX, above: e.clientY, below: e.clientY, path: chip }); return; }
      const text = selectionInFlow();
      if (text) setMenu({ x: e.clientX, above: e.clientY, below: e.clientY, text });
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
  }, [close]);

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

  // 三个浮层共用一套浮条样式，按钮集不同；右键菜单按锚点分文件动作 / 复制
  const bar = (buttons: React.ReactNode) =>
    createPortal(
      <div ref={barRef} className="sel-actions" style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999 }}>
        {buttons}
      </div>,
      document.body,
    );

  if (popup) {
    return bar((
      <>
        <button onClick={() => appendToComposer(popup.text)}>{t("添加到当前任务")}</button>
        <button onClick={() => void copy(popup.text)}>{t("复制")}</button>
      </>
    ));
  }
  if (file) {
    return bar((
      <>
        <button onClick={() => { openPath(file.path); close(); }}>{t("默认应用打开")}</button>
        <button onClick={() => { revealPath(file.path); close(); }}>{t("在 Finder 中显示")}</button>
      </>
    ));
  }
  if (menu) {
    return bar(<button onClick={() => void copy(menu.text)}>{t("复制")}</button>);
  }
  return null;
}
