// 浏览器 pane 的壳载体：页面由壳里的第二个 WKWebView 承载（对应官方 sidebar-browser 的
// Electron 载体那一支），SPA 只画占位槽位并把它的 rect 推给壳。
//
// 与 iframe 载体的差别（官方注释同义）：原生载体**自己有真历史**，所以后退/前进/地址/标题
// 全部以壳的观察为准，不走 browserNavigation 那套"应用自己记历史 + 未知地址"的状态机。
// 两条载体最终产出同一个 BrowserFrameState，工具栏因此不认识载体类型。

import { useCallback, useEffect, useRef, useState } from "react";
import { onHostEvent, sendToShell } from "../host";
import { parseBrowserAddress, type BrowserAddressFailure, type BrowserTarget } from "./browserUrl";
import type { BrowserFrameState } from "./useIframeBrowser";

/** 壳推上来的浏览器观察（`browserState` 指令的载荷）。 */
interface NativeBrowserState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: boolean;
}

const EMPTY: NativeBrowserState = { url: "", title: "", loading: false, canGoBack: false, canGoForward: false, error: false };

export interface NativeBrowser {
  frame: BrowserFrameState;
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
export function useNativeBrowser(applicationOrigin: string): NativeBrowser {
  const [observed, setObserved] = useState<NativeBrowserState>(EMPTY);
  const [draft, setDraft] = useState("");
  const [failure, setFailure] = useState<BrowserAddressFailure | undefined>(undefined);
  const editing = useRef(false);

  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd !== "browserState") return;
    setObserved({ ...EMPTY, ...(payload as Partial<NativeBrowserState> | undefined) });
  }), []);

  const load = useCallback((value: string) => {
    const parsed = parseBrowserAddress(value, applicationOrigin);
    if (!parsed.ok) {
      setFailure(parsed.reason);
      return;
    }
    setFailure(undefined);
    sendToShell({ type: "browser-nav", action: "load", url: parsed.target.url });
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
