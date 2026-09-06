import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { readWorkspaceIcon } from "../host";
import { useStore } from "../store";
import type { WorkspaceView } from "../types";

// 底部空间切换条：一格一空间，当前高亮。只管条内滚动体验——溢出时隐藏
// 滚动条、两端渐隐提示还有更多、滚轮就地消费不外链；不管空间增删入口
// （ws-add 在 Sidebar）与横滑切空间手势（侧栏级，Sidebar.onSidebarWheel）。

// 空间格图标缓存（用户需求：优先项目内 icon/logo，无则首字母）：壳每次都
// 读盘，按路径模块级缓存；工作空间集合在会话内基本不变，不做失效机制。
const wsIconCache = new Map<string, string | null>();

function useWorkspaceIcon(path: string | undefined): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(() => (path ? wsIconCache.get(path) ?? null : null));
  useEffect(() => {
    if (!path) return;
    const cached = wsIconCache.get(path);
    if (cached !== undefined) {
      setDataUrl(cached);
      return;
    }
    let alive = true;
    void readWorkspaceIcon(path).then((url) => {
      wsIconCache.set(path, url);
      if (alive) setDataUrl(url);
    });
    return () => { alive = false; };
  }, [path]);
  return dataUrl;
}

/// 空间格：项目根目录有约定图标文件（icon.png / logo.* 等，壳侧读盘）
/// 显示缩略图，否则回落项目首字母。
function WorkspaceCell({ ws, active, onSwitch }: { ws: WorkspaceView; active: boolean; onSwitch: () => void }) {
  const icon = useWorkspaceIcon(ws.path);
  return (
    <button
      className={`ws-cell${active ? " active" : ""}`}
      data-tip={ws.title}
      onClick={onSwitch}
    >
      {icon
        ? <img className="ws-cell-icon" src={icon} alt={ws.title} />
        : (ws.title.trim()[0] ?? "?").toUpperCase()}
    </button>
  );
}

export function WsSwitcher() {
  const store = useStore();
  const stripRef = useRef<HTMLDivElement>(null);
  // 两端是否还有够不着的内容（渐隐提示的开关）。1px 容差抗亚像素抖动。
  const [fade, setFade] = useState({ start: false, end: false });

  // 滚轮就地消费：条子有横向溢出时，纵横滚轮都只滚条子本身。
  // preventDefault 挡浏览器默认的滚动链接（否则纵滚轮会链去上方会话
  // 列表——用户报告的"这边滚、上面跟着动"）；stopPropagation 挡侧栏级
  // 横滑切空间（正在滚的就是空间条本身，两个行为叠加互相打架）。
  // React onWheel 是 passive 监听，preventDefault 无效，必须原生挂。
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth - el.clientWidth <= 0) return; // 无溢出：维持默认
      e.preventDefault();
      e.stopPropagation();
      el.scrollLeft += Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // 渐隐测量：scroll（用户滚动）+ ResizeObserver（侧栏拖宽/收展）+
  // 空间数量变化（dep 重跑）三路触发；值不变时回传原引用避免多余渲染。
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      const start = el.scrollLeft > 1;
      const end = max - el.scrollLeft > 1;
      setFade((p) => (p.start === start && p.end === end ? p : { start, end }));
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", measure); ro.disconnect(); };
  }, [store.workspaces.length]);

  return (
    <div
      className="ws-switcher"
      ref={stripRef}
      data-fade-start={fade.start ? "" : undefined}
      data-fade-end={fade.end ? "" : undefined}
    >
      {/* 内包一层 auto margin 居中：justify-content: center 在溢出时会把
          首端格子挤出可滚范围（flex 数据丢失），auto margin 溢出时归零 */}
      <div className="ws-switcher-cells">
        {store.workspaces.map((w) => (
          <WorkspaceCell
            key={w.workspaceId}
            ws={w}
            active={w.workspaceId === store.activeWorkspaceId}
            onSwitch={() => store.switchWorkspace(w.workspaceId)}
          />
        ))}
      </div>
    </div>
  );
}
