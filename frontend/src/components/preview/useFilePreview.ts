// 文件预览的状态：多标签 + 活动标签 + 分栏 pane + 全屏。全屏 = 预览取代
// 会话界面（SessionView 据此让消息流/输入框让位并给头部加返回钮）。
// 只管状态，不碰渲染——呈现归 FilePreviewWindow，谁打开文件由调用方决定。

import { useCallback, useState } from "react";

export interface PreviewTab {
  path: string;
  name: string;
}

interface PreviewState {
  tabs: PreviewTab[];
  activePath: string | null;
  /** 分栏 pane 的路径（null = 未分栏）；与主 pane 同标签集。 */
  splitPath: string | null;
  fullscreen: boolean;
}

export interface FilePreview extends PreviewState {
  open: (path: string) => void;
  close: (path: string) => void;
  closeAll: () => void;
  setActive: (path: string) => void;
  toggleSplit: () => void;
  setFullscreen: (v: boolean) => void;
}

/** 空态即「预览已关闭」；关掉最后一个标签回到它（全屏态一并复位，不留空壳）。 */
const CLOSED: PreviewState = { tabs: [], activePath: null, splitPath: null, fullscreen: false };

export function useFilePreview(): FilePreview {
  const [state, setState] = useState<PreviewState>(CLOSED);

  const open = useCallback((path: string) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.some((x) => x.path === path)
        ? prev.tabs
        : [...prev.tabs, { path, name: path.split("/").pop() ?? path }],
      activePath: path,
    }));
  }, []);

  const close = useCallback((path: string) => {
    setState((prev) => {
      const tabs = prev.tabs.filter((x) => x.path !== path);
      if (tabs.length === 0) return CLOSED;
      return {
        tabs,
        activePath: prev.activePath === path ? tabs[tabs.length - 1].path : prev.activePath,
        splitPath: prev.splitPath === path ? null : prev.splitPath,
        fullscreen: prev.fullscreen,
      };
    });
  }, []);

  const closeAll = useCallback(() => setState(CLOSED), []);
  const setActive = useCallback((path: string) => setState((prev) => ({ ...prev, activePath: path })), []);
  const toggleSplit = useCallback(() => {
    setState((prev) => ({ ...prev, splitPath: prev.splitPath === null ? prev.activePath : null }));
  }, []);
  const setFullscreen = useCallback((v: boolean) => setState((prev) => ({ ...prev, fullscreen: v })), []);

  return { ...state, open, close, closeAll, setActive, toggleSplit, setFullscreen };
}
