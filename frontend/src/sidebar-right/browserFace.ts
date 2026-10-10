// 窗口级浏览器的"当前页"镜像：会话头的浏览器入口要显示 agent 在看哪一页，而浏览器是
// **窗口一份**（壳里一个 BrowserTabs，见 SPEC-BROWSER-USE §3），面板不挂载时那份
// browserTabs/browserState 推送就没有消费者——这里补一个只读镜像，挂在模块级，
// 与会话/面板状态无关。
//
// 只读不写：命令仍走面板那支 useNativeBrowser（同一份推送、两个消费者），这里不碰
// 地址栏、标签操作与任何命令通道。

import { useSyncExternalStore } from "react";
import { onHostEvent, sendToShell } from "../host";

export interface BrowserFace {
  /** 当前标签的标题（页面自己声明的）；拿不到就空串 */
  title: string;
  /** 当前标签的地址；空 = 还没有页面（空白标签） */
  url: string;
  loading: boolean;
  /** 当前标签的站点图标地址（壳问来的：页面声明的 `link[rel~=icon]`，页面没声明则
   *  站点根的 `/favicon.ico`；随 browserTabs 一起推）。空串 = 还没问出来。
   *  调用方拿它直接画，加载失败自己退记号。 */
  icon: string;
}

const EMPTY: BrowserFace = { title: "", url: "", loading: false, icon: "" };

let face: BrowserFace = EMPTY;
const listeners = new Set<() => void>();
let installed = false;

function commit(next: BrowserFace): void {
  if (next.title === face.title && next.url === face.url && next.loading === face.loading && next.icon === face.icon) return;
  face = next;
  for (const l of listeners) l();
}

/** 首次订阅时装上推送监听，并向壳要一次现状（面板没开过时，壳的那份观察不会主动推）。
 *  壳不在（纯浏览器环境）时两条都是空操作。 */
function install(): void {
  if (installed) return;
  installed = true;
  onHostEvent((cmd, payload) => {
    if (cmd === "browserTabs") {
      const d = payload as { tabs?: Array<{ title?: string; url?: string; loading?: boolean; active?: boolean; icon?: string }>; activeId?: string } | undefined;
      const active = (d?.tabs ?? []).find((tb) => tb.active === true) ?? (d?.tabs ?? [])[0];
      commit({
        title: active?.title ?? "", url: active?.url ?? "",
        loading: active?.loading === true, icon: active?.icon ?? "",
      });
      return;
    }
    if (cmd === "browserState") {
      // browserState 是单页观察，不带 icon——图标只在 browserTabs 的标签镜像里，
      // 留着上一次问到的值，别因为这条推送把它抹掉（否则面板开着时图标会闪没）。
      const d = payload as { title?: string; url?: string; loading?: boolean } | undefined;
      commit({
        title: d?.title ?? "", url: d?.url ?? "",
        loading: d?.loading === true, icon: samePage(face.url, d?.url) ? face.icon : "",
      });
    }
  });
  sendToShell({ type: "browser-sync" });
}

/** 换页（url 变了）时旧图标不再作数；空 url 视为同一页（首帧还没地址）。 */
function samePage(prev: string, next: string | undefined): boolean {
  if (next === undefined || next === "") return true;
  return prev === next;
}

/** 当前页的只读镜像（订阅式）。没有页面时 url 为空串。 */
export function useBrowserFace(): BrowserFace {
  install();
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => face,
    () => EMPTY,
  );
}

/** 测试用的重置入口（模块级状态，用例之间要清）。 */
export function resetBrowserFace(): void {
  face = EMPTY;
  listeners.clear();
  installed = false;
}
