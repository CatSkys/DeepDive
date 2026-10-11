// 右侧边栏的每会话状态与它的纯转移（移植官方 @deepseek-ai/dsh-client-ui-sidebar-right 的
// client/stores.ts 的 SurfaceState 语义，换成不可变对象 + 纯函数）。
//
// 官方口径逐条保留：**每个会话一份**（切会话各记各的）、**内存态**（重载回默认收起）、
// **一个会话从收起且空开始**。这里只管状态，不碰 DOM 与取数。

/** 面板里的两个页：默认页（屏幕缩略图 + 能力分区）与浏览器页（工具栏 + 整页）。 */
export type PanelMode = "session" | "browser";

/** 一个会话的面板状态。 */
export interface SurfaceState {
  open: boolean;
  /** 呈现：false=push（会话让位），true=fullscreen（盖住整卡）。官方两种呈现。 */
  fullscreen: boolean;
  mode: PanelMode;
  /** 正在显示「会话设置」视图（默认页之上的替换面；浏览器页/收起态不存在它）。 */
  settings: boolean;
}

export function emptySurface(): SurfaceState {
  return { open: false, fullscreen: false, mode: "session", settings: false };
}

export function expand(surface: SurfaceState): SurfaceState {
  return { ...surface, open: true };
}

/** 收起面板，连全屏与设置视图一起收（不留一个全屏的空面板）。 */
export function collapse(surface: SurfaceState): SurfaceState {
  return { ...surface, open: false, fullscreen: false, mode: "session", settings: false };
}

export function toggleExpanded(surface: SurfaceState): SurfaceState {
  return surface.open ? collapse(surface) : expand(surface);
}

export function setFullscreen(surface: SurfaceState, fullscreen: boolean): SurfaceState {
  return { ...surface, fullscreen };
}

export function setMode(surface: SurfaceState, mode: PanelMode): SurfaceState {
  return { ...surface, mode };
}

/** 会话设置视图（会话标题/齿轮的入口）：开 = 顺带展开面板并退回默认页呈现；
 *  关 = 只摘掉设置视图，面板保持原样。 */
export function setSettings(surface: SurfaceState, on: boolean): SurfaceState {
  if (!on) return { ...surface, settings: false };
  return { ...surface, open: true, fullscreen: false, mode: "session", settings: true };
}

/** 点缩略图展开浏览器：换页并进全屏（"以展开的形式显示网页内容"）；
 *  设置视图属于默认页，进浏览器页一并摘掉。 */
export function expandBrowser(surface: SurfaceState): SurfaceState {
  return { ...surface, open: true, fullscreen: true, mode: "browser", settings: false };
}

/** 胶囊的浏览器入口：开面板到浏览器页但呈现仍是边栏（用户 2026-10-11 定稿——
 *  全屏留给屏幕缩略图那个入口）。设置视图属于默认页，一并摘掉。 */
export function openBrowser(surface: SurfaceState): SurfaceState {
  return { ...surface, open: true, fullscreen: false, mode: "browser", settings: false };
}

/** 从浏览器页退回默认页（会话让位恢复，呈现也跟着退回 push）。 */
export function showSession(surface: SurfaceState): SurfaceState {
  return { ...surface, fullscreen: false, mode: "session" };
}
