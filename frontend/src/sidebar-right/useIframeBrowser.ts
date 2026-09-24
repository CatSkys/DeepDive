// 浏览器 pane 的共用视图模型与 iframe 载体（移植官方 sidebar-browser 的
// client/view/BrowserBody 的 frame 形状 + client/browser/IframeImpl）。
//
// iframe 载体是官方两种载体里的 Web 那一支：跨域页面读不到地址，所以历史与"当前地址"
// 全由应用自己记（browserNavigation），首帧之后再有一次 load 就说明页面自己跳走了 →
// 地址转 unknown、后退前进置灰。壳里的原生载体不走这套（WKWebView 有真历史），
// 两条路最终都产出同一个 BrowserFrameState 给工具栏。

import { useCallback, useEffect, useRef, useState } from "react";
import { parseBrowserAddress, type BrowserAddressFailure, type BrowserTarget } from "./browserUrl";
import {
  back, canGoBack, canGoForward, currentTarget, emptyBrowserTabState, forward, frameFailed, frameLoaded,
  navigate, reload, type BrowserTabState,
} from "./browserNavigation";

/** 工具栏与呈现共用的帧状态（官方 BrowserFrameState 的同形裁剪）。 */
export interface BrowserFrameState {
  target: BrowserTarget | undefined;
  /** ""=还没有目标；"unknown"=页面自己跳走了、地址不可知；否则是当前地址。 */
  address: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** 载体报的加载失败。 */
  error: boolean;
}

/** iframe 的固定沙箱（官方常量原文）：不给 top-navigation、不给下载，弹窗可逃逸。 */
export const WEB_BROWSER_SANDBOX = "allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox";

export interface IframeBrowser {
  frame: BrowserFrameState;
  /** 当前请求的代次：iframe 用 key=revision 重挂，load 事件也按它对回去。 */
  revision: number;
  draft: string;
  setDraft: (v: string) => void;
  failure: BrowserAddressFailure | undefined;
  submit: () => void;
  goBack: () => void;
  goForward: () => void;
  doReload: () => void;
  loaded: (revision: number) => void;
  failed: (revision: number) => void;
}

/**
 * iframe 载体的浏览器状态机。
 * @param applicationOrigin 当前 SPA 的 origin，命中即拒（页面不能把自己嵌进自己）。
 */
export function useIframeBrowser(applicationOrigin: string): IframeBrowser {
  const [state, setState] = useState<BrowserTabState>(emptyBrowserTabState);
  const [draft, setDraft] = useState("");
  const [failure, setFailure] = useState<BrowserAddressFailure | undefined>(undefined);
  const editing = useRef(false);

  /** 地址校验 + 导航（官方 BrowserController.loadUrl 的同义）。 */
  const load = useCallback((value: string) => {
    const parsed = parseBrowserAddress(value, applicationOrigin);
    if (!parsed.ok) {
      setFailure(parsed.reason);
      return;
    }
    setFailure(undefined);
    setState((s) => navigate(s, parsed.target));
  }, [applicationOrigin]);

  const target = currentTarget(state);
  const address = state.navigation.status === "unknown" ? "unknown" : (target?.url ?? "");

  // 观察到的地址回填输入框，但用户正在输入时不打断（官方同样只在非编辑态回填）
  useEffect(() => {
    if (editing.current || address === "unknown" || address === "") return;
    setDraft(address);
  }, [address]);

  const frame: BrowserFrameState = {
    target,
    address,
    loading: state.navigation.status === "loading",
    canGoBack: canGoBack(state),
    canGoForward: canGoForward(state),
    error: state.failure === "load-failed",
  };

  return {
    frame,
    revision: state.request?.revision ?? 0,
    draft,
    setDraft: (v) => { editing.current = true; setDraft(v); },
    failure,
    submit: () => { editing.current = false; load(draft); },
    goBack: () => setState((s) => back(s) ?? s),
    goForward: () => setState((s) => forward(s) ?? s),
    doReload: () => setState((s) => reload(s) ?? s),
    loaded: (revision) => setState((s) => frameLoaded(s, revision)),
    failed: (revision) => setState((s) => frameFailed(s, revision)),
  };
}
