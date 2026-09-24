// 右侧边栏的每会话状态与它的纯转移（移植官方 @deepseek-ai/dsh-client-ui-sidebar-right 的
// client/stores.ts 的 SurfaceState 语义，换成不可变对象 + 纯函数）。
//
// 官方口径逐条保留：**每个会话一份**（切会话各记各的）、**内存态**（重载回默认收起）、
// **一个会话从收起且空开始**、展开时才补默认页。这里只管状态，不碰 DOM 与取数。

/** tab 型：本仓注册的三种页。 */
export type TabKind = "guide" | "browser" | "status";

/** 一个打开的 tab。title 在开启时定格（官方：title(address) 捕获进记录）。 */
export interface TabRecord {
  id: string;
  kind: TabKind;
  title: string;
  /** 打开时带的参数（官方 navigation.params 的对应物）：如 browser 的初始 url。 */
  params?: Record<string, unknown>;
}

/** 一个会话的面板状态。 */
export interface SurfaceState {
  open: boolean;
  /** 呈现：false=push（会话让位），true=fullscreen（盖住整卡）。官方两种呈现。 */
  fullscreen: boolean;
  tabs: TabRecord[];
  activeId: string | null;
  /** id 铸造计数：官方把它带在 surface 上以便序列可重放，这里只用于生成稳定 id。 */
  minted: number;
}

export function emptySurface(): SurfaceState {
  return { open: false, fullscreen: false, tabs: [], activeId: null, minted: 0 };
}

/** 铸造一个 tab id（会话内唯一即可）。 */
export function mintTabId(surface: SurfaceState): { id: string; minted: number } {
  const minted = surface.minted + 1;
  return { id: `t${minted}`, minted };
}

/** 官方规则：展开时补默认页，收起时不留。 */
export function ensureDefaultPage(surface: SurfaceState, defaultKind: TabKind, defaultTitle: string): SurfaceState {
  if (surface.tabs.length > 0) return surface;
  const { id, minted } = mintTabId(surface);
  return { ...surface, tabs: [{ id, kind: defaultKind, title: defaultTitle }], activeId: id, minted };
}

/** 展开面板（若还没有内容就补默认页）。 */
export function expand(surface: SurfaceState, defaultKind: TabKind, defaultTitle: string): SurfaceState {
  return { ...ensureDefaultPage(surface, defaultKind, defaultTitle), open: true };
}

/** 收起面板。官方：收起把整列收掉、不留空布局。 */
export function collapse(surface: SurfaceState): SurfaceState {
  return { ...surface, open: false, fullscreen: false };
}

export function toggleExpanded(surface: SurfaceState, defaultKind: TabKind, defaultTitle: string): SurfaceState {
  return surface.open ? collapse(surface) : expand(surface, defaultKind, defaultTitle);
}

export function setFullscreen(surface: SurfaceState, fullscreen: boolean): SurfaceState {
  return { ...surface, fullscreen };
}

/**
 * 开一个 tab（官方 openTab 的语义裁剪到单 pane）：
 * 已存在同 kind 且同地址的 tab 就聚焦它，否则新开并聚焦。展开面板——用户看不到的内容不算打开。
 */
export function openTab(
  surface: SurfaceState,
  kind: TabKind,
  title: string,
  params?: Record<string, unknown>,
  opts?: { revealIfOpened?: boolean; replaceActive?: boolean },
): SurfaceState {
  const reveal = opts?.revealIfOpened ?? true;
  const address = typeof params?.url === "string" ? params.url : undefined;
  const existing = surface.tabs.find((t) => t.kind === kind && sameAddress(t, address));
  if (existing !== undefined) {
    return { ...surface, open: true, activeId: reveal ? existing.id : surface.activeId };
  }
  const { id, minted } = mintTabId(surface);
  const record: TabRecord = { id, kind, title, ...(params === undefined ? {} : { params }) };
  const tabs = opts?.replaceActive === true && surface.activeId !== null
    ? surface.tabs.map((t) => (t.id === surface.activeId ? record : t))
    : [...surface.tabs, record];
  return { ...surface, open: true, tabs, activeId: id, minted };
}

/** 同 kind 的两个 tab 是否指向同一地址（页型无地址，视为总不同）。 */
function sameAddress(tab: TabRecord, address: string | undefined): boolean {
  if (address === undefined) return false;
  return tab.params?.url === address;
}

/**
 * 关一个 tab。官方规则：别的 tab 单独存在时关掉它连同整列一起收；这里同样收列
 * （guide 的"唯一常驻不可关"规则不适用——本仓 guide 不是常驻页）。
 */
export function closeTab(surface: SurfaceState, id: string): SurfaceState {
  const tabs = surface.tabs.filter((t) => t.id !== id);
  if (tabs.length === 0) return collapse({ ...surface, tabs: [], activeId: null });
  const activeId = surface.activeId === id ? (tabs[tabs.length - 1]?.id ?? null) : surface.activeId;
  return { ...surface, tabs, activeId };
}

export function focusTab(surface: SurfaceState, id: string): SurfaceState {
  return surface.tabs.some((t) => t.id === id) ? { ...surface, activeId: id } : surface;
}
