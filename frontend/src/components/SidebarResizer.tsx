// 侧栏右缘拖拽调宽热区：完全不可见（无分隔线），仅 col-resize 光标。
// 拖拽中直写 CSS 变量（绕过 React 重渲染，长会话列表下不掉帧），
// 落点才回写 store（状态 + 壳 prefs 持久化，跨重启保留）。
// move/up 挂 window：不依赖 setPointerCapture（未受信/合成事件下
// capture 可能被 WebKit 忽略），任何输入路径下拖出元素仍持续跟踪。
// data-strip-interactive：进 titlebar.ts 顶条 rect 表，热区上段
// （52px 拖窗条带内）依旧可拖调宽而非拖动窗口。双击回默认宽 240。
import { useStore } from "../store";
import { useT } from "../i18n";

const MIN_W = 200;
const MAX_W = 320;
const DEFAULT_W = 240;

export function SidebarResizer() {
  const store = useStore();
  const { t } = useT();
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const startX = e.clientX;
    const startW = store.sidebarWidth;
    const widthAt = (x: number) => Math.min(MAX_W, Math.max(MIN_W, startW + (x - startX)));
    const onMove = (ev: PointerEvent) => {
      document.documentElement.style.setProperty("--dsh-sidebar-w", `${widthAt(ev.clientX)}px`);
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (commit) store.setSidebarWidth(widthAt(lastX));
      else document.documentElement.style.setProperty("--dsh-sidebar-w", `${store.sidebarWidth}px`);
    };
    let lastX = startX;
    const onUp = (ev: PointerEvent) => { lastX = ev.clientX; finish(true); };
    const onCancel = () => finish(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    e.preventDefault();
  };
  return (
    <div
      className="sidebar-resizer"
      data-strip-interactive=""
      role="separator"
      aria-orientation="vertical"
      aria-label={t("调整侧栏宽度")}
      onPointerDown={onPointerDown}
      onDoubleClick={() => store.setSidebarWidth(DEFAULT_W)}
    />
  );
}
