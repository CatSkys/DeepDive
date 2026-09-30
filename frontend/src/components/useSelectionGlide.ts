// 选中态滑移：一片绝对定位的底跟着选中项走（只改 top/left/width/height，
// 位移走 theme.css 的 --dur-med + --ease-out），选中项自己不再换背景色。
//
// 观感来源：浏览器标签条的 .panel-browser-chrome-glide（同一份配方），以及
// macOS Tahoe 分段控件的"选中从一个地方滑到另一个地方"——不是每一项各自闪一下。
// 三处调用（侧栏会话行 / 统计分段 / 底部空间条）共用这一个钩子，别再各写一份。
//
// 两个坑：
// 三个坑，都是实机踩出来的：
// ① 首次落位不播（transition: none 一帧）。否则列表刚挂载时底片在 (0,0)，
//    播出来是"从左上角飞进来"。用 state 而不是 ref 记这件事——ref 改了不重渲，
//    transition: none 会赖着不走。
// ② **只靠选择器字符串不够**：换选中项时那串选择器没变（属性只是从一行搬到另一行），
//    钩子不会知道"选中的换人了"，底片就停在旧行上——表现是选中的那行没有底色、
//    底片压在别的行上（2026-09-30 用户报"选中态失效"）。所以选中项的身份要作为
//    依赖显式传进来（selectedKey）。
// ③ **ResizeObserver 不报位置变化**：列表内容会在容器尺寸不变的情况下整体位移
//    （新增/归档、时间分组滚动、换项目空间），它一次都不响。所以每次渲染后都重量。
//
// 容器用回调 ref 交进来（setContainer），因为三处的容器都已经被别的 ref 占着
// （渐隐测量等），要能叠加。
//
// 用法：useSelectionGlide(选择器, 选中项身份)——两样都要传，理由见坑 ②。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, Dispatch, SetStateAction } from "react";

export type GlideBox = { top: number; left: number; width: number; height: number };

export function useSelectionGlide<T extends HTMLElement>(selector: string | null, selectedKey: string | number | null): {
  /** 定位祖先（必须 position: relative）：回调 ref */
  setContainer: Dispatch<SetStateAction<T | null>>;
  box: GlideBox | null;
  /** 传给底片的 style：首次落位禁掉 transition，其余交给 CSS */
  glideStyle: CSSProperties;
} {
  const [container, setContainer] = useState<T | null>(null);
  const [box, setBox] = useState<GlideBox | null>(null);
  const [placed, setPlaced] = useState(false);

  // 量出来一样就交回同一个对象，React 才会跳过重渲——否则"每次渲染都量"会自激。
  const measure = useCallback(() => {
    const el = selector ? container?.querySelector<HTMLElement>(selector) : null;
    if (!container || !el) {
      setBox(null);
      return;
    }
    const next: GlideBox = { top: el.offsetTop, left: el.offsetLeft, width: el.offsetWidth, height: el.offsetHeight };
    setBox((prev) => (prev && prev.top === next.top && prev.left === next.left
      && prev.width === next.width && prev.height === next.height) ? prev : next);
  }, [container, selector]);

  // 每次渲染后都量：见坑 ③（容器尺寸不变、内容整体位移的那类）。
  useLayoutEffect(() => { measure(); });

  useLayoutEffect(() => {
    if (!container) return;
    // 换选中项 / 换容器：立刻重量——见坑 ②
    measure();
    // 换语言、标题折行、窗口变宽：尺寸变了但不一定伴随 React 重渲，靠它兜住。
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    const el = selector ? container.querySelector(selector) : null;
    if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [container, selector, selectedKey, measure]);

  // 落位后放开 transition（下一帧）——见坑 ①
  const rafRef = useRef(0);
  useEffect(() => {
    if (!box || placed) return;
    rafRef.current = requestAnimationFrame(() => setPlaced(true));
    return () => cancelAnimationFrame(rafRef.current);
  }, [box, placed]);

  return {
    setContainer,
    box,
    glideStyle: {
      top: box?.top,
      left: box?.left,
      width: box?.width,
      height: box?.height,
      transition: placed ? undefined : "none",
    },
  };
}
