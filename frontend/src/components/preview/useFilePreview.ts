// 文件预览的状态：多标签 + 活动标签 + 全屏 + 每标签的视图偏好（渲染器/换行/
// 跳行落点）。全屏 = 预览取代会话界面（SessionView 据此让消息流/输入框让位
// 并给页头加返回钮）。只管状态，不碰渲染——呈现归 FilePreviewWindow。

import { useCallback, useState } from "react";
import { renderersOf, supportsWrap, type PreviewRenderer } from "./previewModel";

export interface PreviewTab {
  path: string;
  name: string;
  /** 选中的渲染器；undefined = 该文件候选表的默认（第一个）。 */
  renderer?: PreviewRenderer;
  /** 长行折行；undefined = 按渲染器默认（code/text 默认开）。 */
  wrap?: boolean;
  /** 打开时指定的目标行（跳行），关闭/切换即清。 */
  line?: number;
}

interface PreviewState {
  tabs: PreviewTab[];
  activePath: string | null;
  fullscreen: boolean;
}

export interface FilePreview extends PreviewState {
  /** 打开一个文件（已开则切到它）；line 指定跳行落点。 */
  open: (path: string, line?: number) => void;
  close: (path: string) => void;
  closeAll: () => void;
  setActive: (path: string) => void;
  setFullscreen: (v: boolean) => void;
  /** 切当前标签的渲染器（不改变打开的文件）。 */
  setRenderer: (renderer: PreviewRenderer) => void;
  /** 切当前标签的换行。 */
  toggleWrap: () => void;
}

/** 空态即「预览已关闭」；关掉最后一个标签回到它（全屏态一并复位，不留空壳）。 */
const CLOSED: PreviewState = { tabs: [], activePath: null, fullscreen: false };

/** 当前标签的渲染器（候选表默认 = 第一个）。 */
export function rendererOf(tab: PreviewTab): PreviewRenderer {
  return tab.renderer ?? renderersOf(tab.path)[0];
}

/** 当前标签是否折行（未显式设置时用渲染器默认）。 */
export function wrapOf(tab: PreviewTab): boolean {
  return tab.wrap ?? supportsWrap(rendererOf(tab));
}

export function useFilePreview(): FilePreview {
  const [state, setState] = useState<PreviewState>(CLOSED);

  const open = useCallback((path: string, line?: number) => {
    setState((prev) => {
      // 已开的标签：切过去并按本次请求更新目标行；视图偏好原样保留
      const hit = prev.tabs.some((x) => x.path === path);
      return {
        ...prev,
        tabs: hit
          ? prev.tabs.map((x) => (x.path === path ? { ...x, line } : x))
          : [...prev.tabs, { path, name: path.split("/").pop() ?? path, line }],
        activePath: path,
      };
    });
  }, []);

  const close = useCallback((path: string) => {
    setState((prev) => {
      const tabs = prev.tabs.filter((x) => x.path !== path);
      if (tabs.length === 0) return CLOSED;
      return {
        tabs,
        activePath: prev.activePath === path ? tabs[tabs.length - 1].path : prev.activePath,
        fullscreen: prev.fullscreen,
      };
    });
  }, []);

  const closeAll = useCallback(() => setState(CLOSED), []);
  const setActive = useCallback((path: string) => setState((prev) => ({ ...prev, activePath: path })), []);
  const setFullscreen = useCallback((v: boolean) => setState((prev) => ({ ...prev, fullscreen: v })), []);

  /** 只改活动标签的视图偏好（renderer/wrap 都落在标签上，随标签关闭消失）。 */
  const patchActive = useCallback((patch: (tab: PreviewTab) => PreviewTab) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((x) => (x.path === prev.activePath ? patch(x) : x)),
    }));
  }, []);

  const setRenderer = useCallback((renderer: PreviewRenderer) => {
    patchActive((tab) => ({ ...tab, renderer }));
  }, [patchActive]);

  const toggleWrap = useCallback(() => {
    patchActive((tab) => {
      const next = rendererOf(tab);
      return supportsWrap(next) ? { ...tab, wrap: !wrapOf(tab) } : tab;
    });
  }, [patchActive]);

  return { ...state, open, close, closeAll, setActive, setFullscreen, setRenderer, toggleWrap };
}
