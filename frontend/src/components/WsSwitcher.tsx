import { useEffect, useState } from "react";
import { readWorkspaceIcon } from "../host";
import { useStore } from "../store";
import { fadeAttrs, useEdgeFade } from "../useEdgeFade";
import { useWsIcon } from "../wsIcons";
import { WsInitial, wsGlyphIcon } from "./IconPicker";
import { WorkspaceMenu } from "./WorkspaceMenu";
import { useSelectionGlide } from "./useSelectionGlide";
import type { WorkspaceView } from "../types";

// 底部空间切换条：一格一空间，当前高亮。只管条内滚动体验——溢出时隐藏
// 滚动条、两端渐隐提示还有更多、滚轮就地消费不外链；不管空间增删入口
// （ws-add 在 Sidebar）。

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

/// 空间格：优先弹窗里选的项目 glyph，其次项目根目录约定图标文件
/// （icon.png / logo.* 等，壳侧读盘）显示缩略图，否则回落项目首字母。
/// 右键出项目文件夹菜单（与 hero 胶囊同源）。
function WorkspaceCell({ ws, hotkey, active, onSwitch, onContext }: {
  ws: WorkspaceView; hotkey?: string; active: boolean; onSwitch: () => void;
  onContext: (x: number, y: number) => void;
}) {
  const icon = useWorkspaceIcon(ws.path);
  const Glyph = wsGlyphIcon(useWsIcon(ws.workspaceId));
  return (
    <button
      className={`ws-cell${active ? " active" : ""}`}
      {...(active ? { "data-sel": "" } : {})}
      data-tip={ws.title}
      {...(hotkey ? { "data-tip-keys": hotkey } : {})}
      onClick={onSwitch}
      onContextMenu={(e) => { e.preventDefault(); onContext(e.clientX, e.clientY); }}
    >
      {Glyph
        ? <Glyph size={15} />
        : icon
          ? <img className="ws-cell-icon" src={icon} alt={ws.title} />
          : <WsInitial label={ws.title} size={15} />}
    </button>
  );
}

export function WsSwitcher() {
  const store = useStore();
  const fade = useEdgeFade();
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);
  const [ctx, setCtx] = useState<{ ws: WorkspaceView; x: number; y: number } | null>(null);
  const glide = useSelectionGlide<HTMLDivElement>(".ws-cell[data-sel]", store.activeWorkspaceId);

  // 滚轮就地消费：条子有横向溢出时，纵横滚轮都只滚条子本身。
  // preventDefault 挡浏览器默认的滚动链接（否则纵滚轮会链去上方会话
  // 列表——用户报告的"这边滚、上面跟着动"）；stopPropagation 挡侧栏级
  // 侧栏若另有横滑手势会与之打架（正在滚的就是空间条本身）。
  // React onWheel 是 passive 监听，preventDefault 无效，必须原生挂。
  useEffect(() => {
    if (!strip) return;
    const el = strip;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth - el.clientWidth <= 0) return; // 无溢出：维持默认
      e.preventDefault();
      e.stopPropagation();
      el.scrollLeft += Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [strip]);

  // wheel 效果、渐隐测量与滑移底片各持一份引用，ref 回调里聚合到同一元素
  const setRefs = (el: HTMLDivElement | null) => {
    setStrip(el);
    fade.ref(el);
  };

  return (
    <div
      className="ws-switcher fade-x"
      ref={setRefs}
      {...fadeAttrs(fade.fade)}
    >
      {/* 内包一层 auto margin 居中：justify-content: center 在溢出时会把
          首端格子挤出可滚范围（flex 数据丢失），auto margin 溢出时归零 */}
      <div className="ws-switcher-cells" ref={glide.setContainer}>
        {glide.box && <div className="sel-glide glide-ws" style={glide.glideStyle} />}
        {store.workspaces.map((w, i) => (
          <WorkspaceCell
            key={w.workspaceId}
            ws={w}
            hotkey={i < 9 ? `⌥${i + 1}` : undefined}
            active={w.workspaceId === store.activeWorkspaceId}
            onSwitch={() => store.switchWorkspace(w.workspaceId)}
            onContext={(x, y) => setCtx({ ws: w, x, y })}
          />
        ))}
      </div>
      {/* 右键菜单挂条内：位置取右键坐标，点空处由全局 mousedown 关闭 */}
      {ctx && <WorkspaceMenu ws={ctx.ws} x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} />}
    </div>
  );
}
