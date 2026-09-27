// 右侧边栏状态的宿主：模块级「每会话一份」+ 订阅。内存态，与官方 ui-sidebar-right 一致
// （重载回默认收起、切会话各记各的、没有会话就没有面板）。
//
// 为什么不放 store.tsx：这份状态必须活得比 SessionView 长（它按 sessionId 重挂），
// 而 store.tsx 已是 800+ 行的大文件。这里给两个显式出口：usePanelSurface（读）
// 与 panelActions（写），外部不直接碰 Map。

import { useCallback, useSyncExternalStore } from "react";
import {
  collapse, emptySurface, expand, expandBrowser, setFullscreen, setMode, setSettings, showSession,
  type PanelMode, type SurfaceState,
} from "./panelState";

const surfaces = new Map<string, SurfaceState>();
const listeners = new Set<() => void>();

/** 没有会话时的恒定空态：useSyncExternalStore 的 getSnapshot **必须返回稳定引用**，
 *  每次 new 一个会让 React 认为状态一直在变（无限重渲，React #185）。 */
const NO_SESSION = emptySurface();

/** 没有会话就没有面板；首次访问即落进 Map，保证同一会话拿到同一个引用。 */
function surfaceOf(sessionId: string): SurfaceState {
  const existing = surfaces.get(sessionId);
  if (existing !== undefined) return existing;
  const fresh = emptySurface();
  surfaces.set(sessionId, fresh);
  return fresh;
}

function commit(sessionId: string, next: SurfaceState): void {
  surfaces.set(sessionId, next);
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 读某个会话的面板状态（订阅式，状态变更即重渲）。 */
export function usePanelSurface(sessionId: string | null): SurfaceState {
  const get = useCallback(() => (sessionId === null ? NO_SESSION : surfaceOf(sessionId)), [sessionId]);
  return useSyncExternalStore(subscribe, get, get);
}

/** 写：每个动作都要 sessionId；没有会话时全部无操作（官方：无会话无面板）。 */
export const panelActions = {
  setOpen(sessionId: string, open: boolean): void {
    commit(sessionId, open ? expand(surfaceOf(sessionId)) : collapse(surfaceOf(sessionId)));
  },
  toggle(sessionId: string): void {
    const s = surfaceOf(sessionId);
    commit(sessionId, s.open ? collapse(s) : expand(s));
  },
  setFullscreen(sessionId: string, fullscreen: boolean): void {
    commit(sessionId, setFullscreen(surfaceOf(sessionId), fullscreen));
  },
  setMode(sessionId: string, mode: PanelMode): void {
    commit(sessionId, setMode(surfaceOf(sessionId), mode));
  },
  /** 会话设置视图（会话标题/齿轮的入口）：开 = 展开面板并落在设置视图。 */
  setSettings(sessionId: string, on: boolean): void {
    commit(sessionId, setSettings(surfaceOf(sessionId), on));
  },
  /** 点屏幕缩略图：换到浏览器页并进全屏呈现。 */
  expandBrowser(sessionId: string): void {
    commit(sessionId, expandBrowser(surfaceOf(sessionId)));
  },
  /** 从浏览器页退回默认页。 */
  showSession(sessionId: string): void {
    commit(sessionId, showSession(surfaceOf(sessionId)));
  },
  /** 测试用的重置入口。 */
  reset(): void {
    surfaces.clear();
    for (const l of listeners) l();
  },
};
