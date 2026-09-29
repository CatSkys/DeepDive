// 文件预览的状态：多标签 + 活动标签 + 全屏 + 每标签的视图偏好（渲染器/换行/
// 跳行落点）+ 面板模式（文件 / 审查）。全屏 = 预览取代会话界面（SessionView
// 据此让消息流/输入框让位并给页头加返回钮）。只管状态，不碰渲染——呈现归
// FilePreviewWindow。

import { useCallback, useState } from "react";
import { renderersOf, supportsWrap, type PreviewRenderer } from "./previewModel";

/** 面板的两面。审查面（工作区未暂存改动）与文件面共用同一套 chrome。 */
export type PreviewMode = "file" | "review";

export interface PreviewTab {
  path: string;
  name: string;
  /** 选中的渲染器；undefined = 该文件候选表的默认（第一个）。 */
  renderer?: PreviewRenderer;
  /** 长行折行；undefined = 按渲染器默认（code/text 默认开）。 */
  wrap?: boolean;
  /** 打开时指定的目标行（跳行），关闭/切换即清。 */
  line?: number;
  /** PDF 最后可见页（标签级记忆，重开回到那一页）。 */
  page?: number;
}

interface PreviewState {
  tabs: PreviewTab[];
  activePath: string | null;
  fullscreen: boolean;
  mode: PreviewMode;
}

export interface FilePreview extends PreviewState {
  /** 打开一个文件（已开则切到它）；line 指定跳行落点。点文件就是看文件，
   *  所以顺带回到文件面，免得从审查面点进来落不回列表。 */
  open: (path: string, line?: number) => void;
  close: (path: string) => void;
  closeAll: () => void;
  setActive: (path: string) => void;
  setFullscreen: (v: boolean) => void;
  /** 切当前标签的渲染器（不改变打开的文件）。 */
  setRenderer: (renderer: PreviewRenderer) => void;
  /** 切当前标签的换行。 */
  toggleWrap: () => void;
  /** 记当前标签的 PDF 可见页。 */
  setPage: (page: number) => void;
  /** 切面板模式。 */
  setMode: (mode: PreviewMode) => void;
  /** 打开审查面（胶囊的「更改」行走这里）。 */
  openReview: () => void;
}

/** 空态即「预览已关闭」；关掉最后一个标签回到它（全屏态与模式一并复位，不留空壳）。 */
const CLOSED: PreviewState = { tabs: [], activePath: null, fullscreen: false, mode: "file" };

/** 面板是否该出现：文件面要非空标签，审查面自己就是内容。 */
export function previewOpen(state: PreviewState): boolean {
  return state.mode === "review" || state.tabs.length > 0;
}

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
        mode: "file" as const,
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
        mode: prev.mode,
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

  const setPage = useCallback((page: number) => {
    patchActive((tab) => (tab.page === page ? tab : { ...tab, page }));
  }, [patchActive]);

  const setMode = useCallback((mode: PreviewMode) => setState((prev) => ({ ...prev, mode })), []);
  const openReview = useCallback(() => setState((prev) => ({ ...prev, mode: "review" as const })), []);

  return { ...state, open, close, closeAll, setActive, setFullscreen, setRenderer, toggleWrap, setPage, setMode, openReview };
}
