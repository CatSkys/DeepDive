// 浏览器顶部那一行**行尾**的工具组：三键 + 书签 + 「…」菜单 + 「对话」。
//
// 地址框不在这一份里——它就是选中标签那一枚（BrowserTabStrip），空白标签页那款在
// BrowserBlankPage；两处共用同一份 BrowserAddressField。
import { BookOpen, ChevronLeft, ChevronRight, EyeOff, RotateCw, MessageSquare, Search, ShieldOff, ShieldCheck, SquareArrowOutUpRight, Maximize2, Star, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { t, tt } from "../i18n";
import { RowMenu } from "../components/controls";
import { openExternalUrl } from "../host";
import type { PaneFace } from "./useIframeBrowser";

/** 面板那一行行尾的工具组（参考 `Metrics.helm` 的位置：标签之后的右端）。
 *
 *  地址框不在这一份里——它是**选中标签那一枚**（见 BrowserTabStrip），空白标签页那款在
 *  BrowserBlankPage；这里只有三键与菜单，两处共用。
 */
export function BrowserToolbar({ external, onChat, zoom, shield, reader, hidden, bookmark, onFind, face, sandbox }: {
  /** 「…」菜单的"在默认浏览器打开"（地址未知时没有这一项） */
  external?: string;
  onChat: () => void;
  zoom?: { value: number; zoomIn: () => void; zoomOut: () => void; zoomReset: () => void };
  shield?: { paused: boolean; toggle: () => void };
  reader?: { on: boolean; toggle: () => void };
  hidden?: { count: number; picking: boolean; togglePick: () => void; restore: () => void };
  bookmark?: { on: boolean; toggle: () => void };
  onFind?: () => void;
  face: PaneFace;
  /** 只有 iframe 载体给得出沙箱开关；原生载体由壳执行策略，不给这个按钮。 */
  sandbox?: { enabled: boolean; toggle: () => void };
}) {
  const menuItems = [
    ...(zoom ? [
      { v: "zoomIn", label: t("放大"), icon: ZoomIn },
      { v: "zoomOut", label: t("缩小"), icon: ZoomOut },
      { v: "zoomReset", label: tt("重置缩放（{pct}%）", "Reset zoom ({pct}%)", { pct: Math.round(zoom.value * 100) }), icon: Maximize2 },
    ] : []),
    ...(reader ? [{ v: "reader", label: reader.on ? t("退出阅读模式") : t("阅读模式"), icon: BookOpen }] : []),
    ...(hidden ? [{ v: "hide", label: hidden.picking ? t("取消拾取元素") : t("隐藏页面上的元素…"), icon: EyeOff }] : []),
    ...(hidden && hidden.count > 0
      ? [{ v: "restoreHidden", label: tt("恢复本站隐藏的 {n} 项", "Restore the {n} hidden here", { n: hidden.count }), icon: Undo2 }]
      : []),
    ...(shield ? [{ v: "shield", label: shield.paused ? t("本站恢复拦截") : t("本站暂停拦截"), icon: ShieldOff }] : []),
    ...(bookmark ? [{ v: "bookmark", label: bookmark.on ? t("已加入书签") : t("加入书签"), icon: Star }] : []),
    ...(onFind ? [{ v: "find", label: t("页内查找"), icon: Search }] : []),
    ...(external !== undefined ? [{ v: "external", label: t("在默认浏览器中打开"), icon: SquareArrowOutUpRight }] : []),
  ];
  return (
    <div className="panel-browser-helm">
      {sandbox && (
        <button type="button" className={`panel-browser-tool${sandbox.enabled ? " on" : ""}`}
          aria-label={t("沙箱")} data-tip={t("沙箱")} onClick={sandbox.toggle}>
          <ShieldCheck size={14} />
        </button>
      )}
      <button type="button" className="panel-browser-tool" aria-label={t("后退")} data-tip={t("后退")}
        disabled={!face.canGoBack} onClick={face.goBack}>
        <ChevronLeft size={15} />
      </button>
      <button type="button" className="panel-browser-tool" aria-label={t("前进")} data-tip={t("前进")}
        disabled={!face.canGoForward} onClick={face.goForward}>
        <ChevronRight size={15} />
      </button>
      <button type="button" className="panel-browser-tool" aria-label={t("刷新")} data-tip={t("刷新")}
        disabled={face.target === undefined} onClick={face.doReload}>
        <RotateCw size={13} />
      </button>
      {bookmark && (
        <button type="button" className={`panel-browser-tool${bookmark.on ? " on" : ""}`}
          aria-label={bookmark.on ? t("已加入书签") : t("加入书签")}
          data-tip={bookmark.on ? t("已加入书签") : t("加入书签")} onClick={bookmark.toggle}>
          <Star size={14} />
        </button>
      )}
      {menuItems.length > 0 && (
        <RowMenu
          label={t("更多")}
          items={menuItems}
          onSelect={(v) => {
            if (v === "zoomIn") zoom?.zoomIn();
            else if (v === "zoomOut") zoom?.zoomOut();
            else if (v === "zoomReset") zoom?.zoomReset();
            else if (v === "reader") reader?.toggle();
            else if (v === "hide") hidden?.togglePick();
            else if (v === "restoreHidden") hidden?.restore();
            else if (v === "shield") shield?.toggle();
            else if (v === "bookmark") bookmark?.toggle();
            else if (v === "find") onFind?.();
            else if (v === "external" && external !== undefined) openExternalUrl(external);
          }}
        />
      )}
      <button type="button" className="panel-browser-tool" aria-label={t("对话")} data-tip={t("对话")} onClick={onChat}>
        <MessageSquare size={14} />
      </button>
    </div>
  );
}
