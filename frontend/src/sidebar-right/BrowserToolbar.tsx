// 侧栏浏览器的工具栏与地址栏（移植官方 sidebar-browser 的 BrowserBody form 部分）：
// 五钮 + 地址栏（带访问记录/"搜索 xxx"补全）+「…」菜单（缩放/查找/在默认浏览器打开）+「对话」。
//
// 拆出 BrowserPane.tsx 的理由：面板本体只负责"哪支载体、哪种尺寸"，工具栏是另一件事。
import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, EyeOff, RotateCw, MessageSquare, Search, ShieldOff, ShieldCheck, SquareArrowOutUpRight, Maximize2, Star, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { t, tt } from "../i18n";
import { RowMenu } from "../components/controls";
import { browserPrefs } from "./browserPrefs";
import { completeVisits, useVisitsRevision } from "./browserHistory";
import { looksLikeSearch, searchUrlFor } from "./browserUrl";
import { openExternalUrl, sendToShell } from "../host";
import type { BrowserAddressFailure } from "./browserUrl";
import type { BrowserFrameState } from "./useIframeBrowser";

/** 地址被拒的原因 → 用户可见文案（官方 error.* 一组）。 */
function failureText(reason: BrowserAddressFailure): string {
  if (reason === "empty") return t("请输入地址");
  if (reason === "protocol") return t("只支持 http/https 地址");
  if (reason === "credentials") return t("地址里不能带用户名或密码");
  if (reason === "application-origin") return t("不能打开 DeepDive 自己的地址");
  return t("地址无效");
}

export interface PaneFace extends BrowserFrameState {
  draft: string;
  setDraft: (v: string) => void;
  failure: BrowserAddressFailure | undefined;
  submit: () => void;
  /** 直接去一个地址：原生载体给得出（顺带收掉地址栏的编辑态），iframe 载体没有这回事 */
  navigate?: (url: string) => void;
  goBack: () => void;
  goForward: () => void;
  doReload: () => void;
}

/** 工具栏 + 地址栏（官方 BrowserBody 的 form 部分）。
 *  地址栏带补全（自己的访问记录 + "搜索 xxx"）；缩放与"在默认浏览器打开"进「…」菜单。 */
export function BrowserToolbar({ face, sandbox, onChat, zoom, shield, reader, hidden, bookmark, onFind, intent }: {
  face: PaneFace;
  /** 只有 iframe 载体给得出沙箱开关；原生载体由壳执行策略，不给这个按钮。 */
  sandbox?: { enabled: boolean; toggle: () => void };
  /** 叫出悬浮对话卡（壳侧叠加层）。 */
  onChat: () => void;
  /** 缩放（只有原生载体给得出：壳侧的 pageZoom） */
  zoom?: { value: number; zoomIn: () => void; zoomOut: () => void; zoomReset: () => void };
  /** 广告/跟踪拦截对本站的开关（原生载体；壳按 host 记） */
  shield?: { paused: boolean; toggle: () => void };
  /** 阅读模式（原生载体；进 = 页面就地换一版，退 = 重载） */
  reader?: { on: boolean; toggle: () => void };
  /** 按站隐藏（原生载体）：进拾取模式，以及把本站藏过的都放回来 */
  hidden?: { count: number; picking: boolean; togglePick: () => void; restore: () => void };
  /** 收藏当前页（原生载体；壳按 url 记） */
  bookmark?: { on: boolean; toggle: () => void };
  onFind?: () => void;
  /** 壳转来的键盘意图：地址栏聚焦 / 查找（id 变化即触发一次） */
  intent?: { kind: "address" | "find"; id: number };
}) {
  const unknown = face.address === "unknown";
  const external = unknown ? undefined : face.target?.url;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const prefs = browserPrefs();
  // 壳推来新历史就重画一次补全（缓存是同步读的，不订阅只会等下一次敲键）
  useVisitsRevision();
  const recents = suggestOpen ? completeVisits(face.draft) : [];
  const searchHint = suggestOpen && prefs.searchOnPlainText && looksLikeSearch(face.draft)
    ? searchUrlFor(face.draft, prefs.searchTemplate)
    : null;
  const suggestions: { url: string; label: string }[] = [
    ...(searchHint !== null ? [{ url: searchHint, label: `${t("搜索")} “${face.draft.trim()}”` }] : []),
    ...recents.map((item) => ({ url: item.url, label: item.title })),
  ];

  const intentKind = intent?.kind;
  const intentId = intent?.id;
  useEffect(() => {
    if (intentKind !== "address") return;
    inputRef.current?.focus();
    inputRef.current?.select();
    setSuggestOpen(false);
  }, [intentId, intentKind]);

  const pick = (url: string) => {
    setSuggestOpen(false);
    setActive(-1);
    // 原生载体走 face.navigate：它顺带清掉地址栏的编辑态（否则选完之后地址栏一直显示你敲的
    // 那串字符、不再镜像壳的 URL）。iframe 载体的地址由页面自己说了算，没有编辑态可清。
    if (face.navigate) { face.navigate(url); return; }
    face.setDraft(url);
    sendToShell({ type: "browser-nav", action: "load", url });
  };

  return (
    <form className="panel-browser-toolbar" onSubmit={(e) => { e.preventDefault(); setSuggestOpen(false); face.submit(); }}>
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
      <div className="panel-browser-address-box">
        <input
          ref={inputRef}
          className={`panel-browser-address${unknown ? " unknown" : ""}`}
          value={face.draft}
          aria-label={t("地址")}
          placeholder={t("输入地址或搜索")}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => { face.setDraft(e.currentTarget.value); setSuggestOpen(true); setActive(-1); }}
          onFocus={() => setSuggestOpen(true)}
          onBlur={() => window.setTimeout(() => setSuggestOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setSuggestOpen(false); return; }
            if (suggestions.length === 0) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % suggestions.length); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1)); return; }
            if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(suggestions[active]!.url); }
          }}
        />
        {unknown && <span className="panel-browser-changed">{t("页面已跳转，地址未知")}</span>}
        {suggestOpen && suggestions.length > 0 && (
          <div className="panel-browser-suggest" role="listbox">
            {suggestions.map((item, index) => (
              <button
                key={`${item.url}-${index}`}
                type="button"
                role="option"
                aria-selected={index === active}
                className={`panel-browser-suggest-item${index === active ? " active" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); pick(item.url); }}
              >
                {item.label}
                <span className="panel-browser-suggest-url">{item.url}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {/* 「…」：缩放（原生载体才有）、查找、在默认浏览器打开。
          一项都没有时不渲染——空菜单留一个点了没反应的入口不如不出（纯浏览器里的空白页
          就是这种情况：没有 zoom、没有 find、地址未知也就没有"在默认浏览器打开"）。 */}
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
      {/* 「对话」：把浮在网页之上的那座对话卡叫出来（原来占着面板标题栏那格） */}
      <button type="button" className="panel-chat-btn" aria-label={t("对话")} data-tip={t("对话")} onClick={onChat}>
        <MessageSquare size={14} />
        <span>{t("对话")}</span>
      </button>
      {sandbox && (
        <button
          type="button"
          className={`panel-browser-tool${sandbox.enabled ? "" : " off"}`}
          aria-label={sandbox.enabled ? t("关闭沙箱") : t("开启沙箱")}
          data-tip={sandbox.enabled ? t("关闭沙箱") : t("开启沙箱")}
          aria-pressed={!sandbox.enabled}
          onClick={sandbox.toggle}
        >
          {sandbox.enabled ? <ShieldCheck size={13} /> : <ShieldOff size={13} />}
        </button>
      )}
      {face.failure !== undefined && <span className="panel-browser-note bad">{failureText(face.failure)}</span>}
      {face.error && <span className="panel-browser-note bad">{t("页面加载失败")}</span>}
    </form>
  );
}

