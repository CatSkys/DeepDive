// 浏览器 pane 的壳载体：页面由壳里的第二个 WKWebView 承载（对应官方 sidebar-browser 的
// Electron 载体那一支），SPA 只画占位槽位并把它的 rect 推给壳。
//
// 与 iframe 载体的差别（官方注释同义）：原生载体**自己有真历史**，所以后退/前进/地址/标题
// 全部以壳的观察为准，不走 browserNavigation 那套"应用自己记历史 + 未知地址"的状态机。
// 两条载体最终产出同一个 BrowserFrameState，工具栏因此不认识载体类型。

import { useCallback, useEffect, useRef, useState } from "react";
import { onHostEvent, sendToShell } from "../host";
import { looksLikeSearch, parseBrowserAddress, searchUrlFor, type BrowserAddressFailure, type BrowserTarget } from "./browserUrl";
import { browserPrefs } from "./browserPrefs";
import type { BrowserFrameState } from "./useIframeBrowser";

/** 壳推上来的浏览器观察（`browserState` 指令的载荷）。 */
interface NativeBrowserState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: boolean;
  /** 当前页面缩放（壳侧 pageZoom） */
  zoom: number;
}

/** 标签栏清单里的一项（`browserTabs` 指令的载荷；壳是标签状态的事实源）。 */
export interface BrowserTabFace {
  id: string;
  title: string;
  url: string;
  /** 站点图标：页面自己声明的那个地址；空 = 没声明，标签栏退回首字母 */
  icon: string;
  /** 睡着 = 宿主已被壳回收（内存），点它先唤醒 */
  asleep: boolean;
  active: boolean;
}

const EMPTY: NativeBrowserState = { url: "", title: "", loading: false, canGoBack: false, canGoForward: false, error: false, zoom: 1 };

/** 壳在网页里截到的浏览器快捷键（`browserKey`）：网页是另一个 WKWebView，焦点在它身上时
     SPA 收不到键，所以这类组合由壳监视并转过来（见 MainWindowController+Browser）。 */
export type BrowserKeyCommand =
  | "address" | "find" | "findNext" | "findPrevious"
  | "reload" | "back" | "forward" | "zoomIn" | "zoomOut" | "zoomReset";

export interface NativeBrowser {
  frame: BrowserFrameState;
  /** 标签栏清单与当前标签（壳推的 `browserTabs`；壳是标签状态的事实源） */
  tabs: BrowserTabFace[];
  activeTabId: string;
  newTab: () => void;
  closeTab: (id: string) => void;
  selectTab: (id: string) => void;
  /** 唤醒期间铺在页面上的停帧图（data:image/png;base64 的裸串）；空 = 没有 */
  cover: string;
  /** 这一站是不是被暂停了拦截（面板菜单显示"暂停/恢复"用） */
  shieldPaused: boolean;
  toggleShield: () => void;
  /** 当前缩放（壳回报） */
  zoom: number;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  /** 页内查找：空串即取消；结果由 findResult 回报 */
  find: (query: string, forward?: boolean) => void;
  findResult: { query: string; found: boolean } | null;
  /** 缩略图预览图（data:image/png;base64 的裸串）；空 = 还没拿到 */
  shot: string | null;
  title: string;
  draft: string;
  setDraft: (v: string) => void;
  failure: BrowserAddressFailure | undefined;
  submit: () => void;
  goBack: () => void;
  goForward: () => void;
  doReload: () => void;
}

/** 壳载体的浏览器状态：观察来自壳，命令发给壳。 */
export function useNativeBrowser(applicationOrigin: string, onKey?: (key: BrowserKeyCommand) => void): NativeBrowser {
  const [observed, setObserved] = useState<NativeBrowserState>(EMPTY);
  const [shot, setShot] = useState<string | null>(null);
  const [findResult, setFindResult] = useState<{ query: string; found: boolean } | null>(null);
  const [tabs, setTabs] = useState<BrowserTabFace[]>([]);
  const [activeTabId, setActiveTabId] = useState("");
  const [cover, setCover] = useState("");
  const [shieldPaused, setShieldPaused] = useState(false);
  // 回调放 ref：壳事件订阅只装一次，不因每次渲染的新函数反复解绑
  const keyHandler = useRef(onKey);
  keyHandler.current = onKey;
  // 当前标签也要一份 ref：订阅闭包里读不到最新的 state，而观察的取舍要看它
  const activeTabRef = useRef("");
  const [draft, setDraft] = useState("");
  const [failure, setFailure] = useState<BrowserAddressFailure | undefined>(undefined);
  const editing = useRef(false);

  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd === "browserTabs") {
      const data = payload as { tabs?: BrowserTabFace[]; activeId?: string } | undefined;
      activeTabRef.current = typeof data?.activeId === "string" ? data.activeId : "";
      setTabs(Array.isArray(data?.tabs) ? data.tabs : []);
      setActiveTabId(activeTabRef.current);
      return;
    }
    if (cmd === "browserState") {
      const data = payload as (Partial<NativeBrowserState> & { tabId?: string; cover?: string }) | undefined;
      // 迟到的旧标签观察丢掉：换标签时壳先推清单（那份是权威），旧标签的观察可能后到
      if (typeof data?.tabId === "string" && activeTabRef.current !== "" && data.tabId !== activeTabRef.current) return;
      const { url, title, loading, canGoBack, canGoForward, error, zoom } = { ...EMPTY, ...data };
      setObserved({ url, title, loading, canGoBack, canGoForward, error, zoom });
      setCover(typeof data?.cover === "string" ? data.cover : "");
      setShieldPaused((data as { shieldPaused?: unknown } | undefined)?.shieldPaused === true);
      return;
    }
    if (cmd === "browserShot") {
      const png = (payload as { png?: unknown } | undefined)?.png;
      if (typeof png === "string" && png) setShot(png);
      return;
    }
    if (cmd === "browserKey") {
      const key = (payload as { key?: unknown } | undefined)?.key;
      if (typeof key === "string") keyHandler.current?.(key as BrowserKeyCommand);
      return;
    }
    if (cmd === "browserFindResult") {
      const data = payload as { query?: unknown; found?: unknown } | undefined;
      setFindResult({ query: typeof data?.query === "string" ? data.query : "", found: data?.found === true });
    }
  }), []);

  // 挂载即主动要一次当前状态：壳的观察是**变化才推**的，而面板关着时 agent 也在用
  // 同一个浏览器（它导航完就推过了）。后挂载的 SPA 收不到那一帧，地址会一直是空的
  // → 走空态、连槽位都不渲染 → 壳里已经打开的页面看不见（用户报"浏览器显示好像没有
  // 正常使用"）。同步后壳回一条 browserState。
  useEffect(() => {
    sendToShell({ type: "browser-sync" });
  }, []);

  // 缩略图预览：页面在壳里按整屏排版，那一格显示的是它的**快照**（不是缩小版的
  // WKWebView——壳侧没有"缩小放进去"这条路，见 BrowserHost.previewShot）。
  // 打开时取一张，之后每 4s 续一张（agent 会滚动/导航，预览要跟得上）。
  useEffect(() => {
    if (observed.url === "") return;
    sendToShell({ type: "browser-shot" });
    const timer = window.setInterval(() => sendToShell({ type: "browser-shot" }), 4000);
    return () => window.clearInterval(timer);
  }, [observed.url]);

  const load = useCallback((value: string) => {
    // 先按地址解析；解析不出、且看着像搜索词 → 交给搜索模板（参考实现 Address.url 的同一分工）
    const parsed = parseBrowserAddress(value, applicationOrigin);
    if (parsed.ok) {
      setFailure(undefined);
      sendToShell({ type: "browser-nav", action: "load", url: parsed.target.url });
      return;
    }
    const prefs = browserPrefs();
    const searchable = prefs.searchOnPlainText && looksLikeSearch(value);
    const searchUrl = searchable ? searchUrlFor(value, prefs.searchTemplate) : null;
    if (searchUrl !== null) {
      setFailure(undefined);
      sendToShell({ type: "browser-nav", action: "load", url: searchUrl });
      return;
    }
    setFailure(parsed.reason);
  }, [applicationOrigin]);

  useEffect(() => {
    if (editing.current || observed.url === "") return;
    setDraft(observed.url);
  }, [observed.url]);

  const target: BrowserTarget | undefined = observed.url === ""
    ? undefined
    : {
        kind: observed.url.startsWith("https:") ? "https" : "http",
        url: observed.url,
        title: observed.title || observed.url,
      };

  const frame: BrowserFrameState = {
    target,
    address: observed.url,
    loading: observed.loading,
    canGoBack: observed.canGoBack,
    canGoForward: observed.canGoForward,
    error: observed.error,
  };

  return {
    frame,
    tabs,
    activeTabId,
    newTab: () => sendToShell({ type: "browser-tabs", action: "new" }),
    closeTab: (id: string) => sendToShell({ type: "browser-tabs", action: "close", id }),
    selectTab: (id: string) => sendToShell({ type: "browser-tabs", action: "select", id }),
    cover,
    shieldPaused,
    // 本站暂停/恢复拦截：host 从当前地址里取（壳按 host 记；取不到就什么都不做）
    toggleShield: () => {
      let host: string;
      try { host = new URL(observed.url).hostname; } catch { return; }
      if (host === "") return;
      sendToShell({ type: "browser-shield", action: shieldPaused ? "resume" : "pause", host });
    },
    zoom: observed.zoom,
    zoomIn: () => sendToShell({ type: "browser-zoom", action: "in" }),
    zoomOut: () => sendToShell({ type: "browser-zoom", action: "out" }),
    zoomReset: () => sendToShell({ type: "browser-zoom", action: "reset" }),
    find: (query: string, forward = true) => sendToShell({ type: "browser-find", query, forward }),
    findResult,
    shot,
    title: observed.title,
    draft,
    setDraft: (v) => { editing.current = true; setDraft(v); },
    failure,
    submit: () => { editing.current = false; load(draft); },
    goBack: () => sendToShell({ type: "browser-nav", action: "back" }),
    goForward: () => sendToShell({ type: "browser-nav", action: "forward" }),
    doReload: () => sendToShell({ type: "browser-nav", action: "reload" }),
  };
}
