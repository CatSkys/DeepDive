// 浏览器页面的载体（移植官方 sidebar-browser 的两支：client/browser/IframeImpl +
// client/view/IframePresentation 与 client/electron/ElectronWebviewPresentation）。
//
// 本仓的两支：壳里 = 原生槽位（壳摆第二个 WKWebView 进去，SPA 只挖洞），
// 纯浏览器里 = iframe。选择由 inShell() 定，不在运行期切换。
//
// iframe 的固定策略照官方：沙箱为 WEB_BROWSER_SANDBOX（不给 top-navigation、不给下载），
// referrerPolicy=no-referrer。壳里的原生载体由壳自己执行同等强度的策略（见 BrowserHost.swift）。

import { t } from "../i18n";
import { inShell } from "../host";
import { WEB_BROWSER_SANDBOX } from "./useIframeBrowser";

/** 原生槽位：壳按这个元素的 rect 摆 WKWebView；id 全局唯一（壳只有一个浏览器视图）。 */
export const NATIVE_BROWSER_SLOT = "browser";

/** 壳载体的槽位元素（无壳桥时不渲染——那时走 iframe）。 */
export function NativeCarrier() {
  return <div className="sr-browser-slot" data-native-slot={NATIVE_BROWSER_SLOT} />;
}

/** iframe 载体：每次请求换 key → 重新挂载即重新加载（应用自有历史的等价物）。 */
export function IframeCarrier({ url, revision, title, onLoad, onError }: {
  url: string;
  revision: number;
  title: string;
  onLoad: (revision: number) => void;
  onError: (revision: number) => void;
}) {
  return (
    <iframe
      key={revision}
      className="sr-browser-frame"
      src={url}
      title={title}
      sandbox={WEB_BROWSER_SANDBOX}
      referrerPolicy="no-referrer"
      onLoad={() => onLoad(revision)}
      onError={() => onError(revision)}
    />
  );
}

/** 还没有任何目标时的空态（两支共用）。 */
export function BrowserEmpty() {
  return <div className="sr-browser-empty">{t("还没有打开的网页")}</div>;
}

/** 载体选择：壳里给原生槽位，否则给 iframe（没有目标时给空态）。 */
export function browserCarrierKind(): "native" | "iframe" {
  return inShell() ? "native" : "iframe";
}
