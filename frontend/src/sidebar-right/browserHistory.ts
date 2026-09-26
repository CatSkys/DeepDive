// 浏览历史的 SPA 侧：**壳是事实源**（`BrowserHistory.swift`），这里只缓存它推过来的最近那份，
// 供两处用：
//   · 地址栏补全（同步读缓存：补全要在 render 里算出来）；
//   · 设置页「历史与书签」那张表（`useBrowserHistory`，可订阅）。
//
// 为什么不在 localStorage 里自己记一份：一件事只能有一个家。以前的 `browserRecents` 是 SPA 自己
// 记的 20 条，与壳里的历史各说各话——现在统一成"壳记、SPA 读"。
import { useEffect, useSyncExternalStore } from "react";
import { onHostEvent, sendToShell } from "../host";

export interface HistoryVisit {
  url: string;
  title: string;
  host: string;
  /** 最后一次访问（毫秒） */
  at: number;
  count: number;
}

export interface BookmarkFace {
  url: string;
  title: string;
  at: number;
}

/** 补全最多取几条（与以前同一口径）。 */
const SUGGEST_LIMIT = 6;

/** 一份稳定引用的快照（useSyncExternalStore 要求"没变就同一个引用"，否则无限重渲）。 */
interface LibraryState {
  visits: HistoryVisit[];
  total: number;
  bookmarks: BookmarkFace[];
}

let state: LibraryState = { visits: [], total: 0, bookmarks: [] };
/** 每次推送 +1：补全是在 render 里同步读缓存的，得有个东西让地址栏知道"缓存变了、重画"。 */
let revision = 0;
const listeners = new Set<() => void>();

function emit(next: Partial<LibraryState>): void {
  state = { ...state, ...next };
  revision += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function snapshot(): LibraryState {
  return state;
}

/** 按输入前缀/子串过滤候选（大小写不敏感，最多 6 条）——地址栏 render 里同步调用。 */
export function completeVisits(input: string): { url: string; title: string }[] {
  const text = input.trim().toLowerCase();
  if (text === "") return [];
  return state.visits
    .filter((item) => item.url.toLowerCase().includes(text) || item.title.toLowerCase().includes(text))
    .slice(0, SUGGEST_LIMIT)
    .map((item) => ({ url: item.url, title: item.title }));
}

/** 让地址栏在壳推来新历史时重画一次（它读缓存是同步的，不订阅就只会等下一次敲键）。 */
export function useVisitsRevision(): number {
  return useSyncExternalStore(subscribe, () => revision, () => revision);
}

/** 页面挂了就注册一次：把壳推来的历史/书签收进缓存（App 根用）。 */
export function useBrowserLibraryBridge(): void {
  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd === "browserHistory") {
      const data = payload as { entries?: HistoryVisit[]; total?: number } | undefined;
      const entries = Array.isArray(data?.entries) ? data.entries : [];
      emit({ visits: entries, total: Number(data?.total ?? entries.length) });
      return;
    }
    if (cmd === "browserBookmarks") {
      const data = payload as { entries?: BookmarkFace[] } | undefined;
      emit({ bookmarks: Array.isArray(data?.entries) ? data.entries : [] });
    }
  }), []);
}

/** 设置页那张表：订阅缓存 + 三个动作。 */
export function useBrowserHistory(): {
  visits: HistoryVisit[];
  total: number;
  bookmarks: BookmarkFace[];
  refresh: (limit?: number) => void;
  remove: (url: string) => void;
  clear: () => void;
  removeBookmark: (url: string) => void;
  clearBookmarks: () => void;
} {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);

  return {
    visits: current.visits,
    total: current.total,
    bookmarks: current.bookmarks,
    // 历史与书签是两条命令：设置页一打开就要两份都问（书签只在增删时才被推过）
    refresh: (limit = 200) => {
      sendToShell({ type: "browser-history", action: "list", limit });
      sendToShell({ type: "browser-bookmarks", action: "list" });
    },
    remove: (url: string) => sendToShell({ type: "browser-history", action: "remove", url }),
    clear: () => sendToShell({ type: "browser-history", action: "clear" }),
    removeBookmark: (url: string) => sendToShell({ type: "browser-bookmarks", action: "remove", url }),
    clearBookmarks: () => sendToShell({ type: "browser-bookmarks", action: "clear" }),
  };
}

/** 书签动作（面板「…」菜单用；设置页走 useBrowserHistory）。 */
export function addBookmark(url: string, title: string): void {
  sendToShell({ type: "browser-bookmarks", action: "add", url, title });
}

export function removeBookmark(url: string): void {
  sendToShell({ type: "browser-bookmarks", action: "remove", url });
}
