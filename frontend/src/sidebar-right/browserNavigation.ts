// 侧栏浏览器的导航状态机（移植官方 @deepseek-ai/dsh-client-ui-sidebar-browser 的
// client/browser/BrowserNavigation.ts）。官方是一个持有可变 value 的类；本仓惯例是纯函数
// 加不可变状态，所以逐条照搬它的转移规则、只换承载形式。
//
// 核心不变量（官方注释原文的意思）：**第一次加载对某个 request 保持 URL 权威；再一次加载
// 就标记为未知**。跨域 iframe 读不到地址，所以一旦页面自己跳走了，我们就只能承认不知道当前
// 地址——那时后退/前进/外部打开全部置灰，刷新回到最后已知地址。

import type { BrowserTarget } from "./browserUrl";

/** 应用已知历史的容量上限（官方 navigate 里的 100）。 */
export const MAX_NAVIGATION_ENTRIES = 100;

/** 观察状态：empty=还没请求过；loading=请求已发出等首帧；known=首帧已到；unknown=页面自己跳走了。 */
export type NavigationStatus = "empty" | "loading" | "known" | "unknown";

/** 一次加载请求：revision 是「这次请求」的代次，用来把迟到的 load 事件对回去。 */
export interface BrowserRequest {
  revision: number;
  target: BrowserTarget;
}

/** 可持久化的标签页导航状态。 */
export interface BrowserTabState {
  entries: BrowserTarget[];
  index: number;
  request: BrowserRequest | undefined;
  navigation: { status: NavigationStatus; revision?: number };
  failure: "load-failed" | undefined;
}

export function emptyBrowserTabState(): BrowserTabState {
  return { entries: [], index: -1, request: undefined, navigation: { status: "empty" }, failure: undefined };
}

/** 当前选中的历史条目。 */
export function currentTarget(state: BrowserTabState | undefined): BrowserTarget | undefined {
  return state === undefined || state.index < 0 ? undefined : state.entries[state.index];
}

export function canGoBack(state: BrowserTabState): boolean {
  return state.navigation.status !== "unknown" && state.index > 0;
}

export function canGoForward(state: BrowserTabState): boolean {
  return state.navigation.status !== "unknown" && state.index >= 0 && state.index < state.entries.length - 1;
}

/** 发一次新请求：代次 +1，状态转 loading，清掉上一次的失败。 */
function request(state: BrowserTabState, target: BrowserTarget, basis: BrowserTabState): BrowserTabState {
  const revision = (state.request?.revision ?? 0) + 1;
  return {
    ...basis,
    request: { revision, target },
    navigation: { status: "loading", revision },
    failure: undefined,
  };
}

/** 追加一个受控目标并丢掉它的前向分支。 */
export function navigate(state: BrowserTabState, target: BrowserTarget): BrowserTabState {
  const entries = [...state.entries.slice(0, state.index + 1), target];
  if (entries.length > MAX_NAVIGATION_ENTRIES) entries.splice(0, entries.length - MAX_NAVIGATION_ENTRIES);
  return request(state, target, { ...state, entries, index: entries.length - 1 });
}

export function back(state: BrowserTabState): BrowserTabState | undefined {
  if (!canGoBack(state)) return undefined;
  const index = state.index - 1;
  return request(state, state.entries[index]!, { ...state, index });
}

export function forward(state: BrowserTabState): BrowserTabState | undefined {
  if (!canGoForward(state)) return undefined;
  const index = state.index + 1;
  return request(state, state.entries[index]!, { ...state, index });
}

/** 重新加载最后一个已知目标（没有目标时无操作）。 */
export function reload(state: BrowserTabState): BrowserTabState | undefined {
  const target = currentTarget(state);
  return target === undefined ? undefined : request(state, target, state);
}

/**
 * 记一次载体加载完成。
 * 只认当前代次：迟到的旧帧 load 不能把状态推错。
 */
export function frameLoaded(state: BrowserTabState, revision: number): BrowserTabState {
  const nav = state.navigation;
  if (nav.status === "empty" || nav.revision !== revision) return state;
  if (nav.status === "loading") return { ...state, navigation: { status: "known", revision } };
  if (nav.status === "known") return { ...state, navigation: { status: "unknown", revision } };
  return state;
}

/** 载体加载失败（iframe 的 error 事件）。 */
export function frameFailed(state: BrowserTabState, revision: number): BrowserTabState {
  if (state.navigation.revision !== revision) return state;
  return { ...state, failure: "load-failed" };
}
