// 选中态滑移：一片绝对定位的底跟着选中项走（只改 top/left/width/height，
// 位移走 theme.css 的 --dur-med + --ease-out），选中项自己不再换背景色。
//
// 观感来源：浏览器标签条的 .panel-browser-chrome-glide（同一份配方），以及
// macOS Tahoe 分段控件的"选中从一个地方滑到另一个地方"——不是每一项各自闪一下。
// 三处调用（侧栏会话行 / 统计分段 / 底部空间条）共用这一个钩子，别再各写一份。
//
// 两个坑：
// ① 首次落位不播（transition: none 一帧）。否则列表刚挂载时底片在 (0,0)，
//    播出来是"从左上角飞进来"。用 state 而不是 ref 记这件事——ref 改了不重渲，
//    transition: none 会赖着不走。
// ② 行高会变（换语言、标题折行、窗口变宽、窗口缩放）→ ResizeObserver 重新量，
//    不然底片停在旧位置。
//
// 容器用回调 ref 交进来（setContainer），因为三处的容器都已经被别的 ref 占着
// （渐隐测量等），要能叠加。

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, Dispatch, SetStateAction } from "react";

export type GlideBox = { top: number; left: number; width: number; height: number };

export function useSelectionGlide<T extends HTMLElement>(selector: string | null): {
  /** 定位祖先（必须 position: relative）：回调 ref */
  setContainer: Dispatch<SetStateAction<T | null>>;
  box: GlideBox | null;
  /** 传给底片的 style：首次落位禁掉 transition，其余交给 CSS */
  glideStyle: CSSProperties;
} {
  const [container, setContainer] = useState<T | null>(null);
  const [box, setBox] = useState<GlideBox | null>(null);
  const [placed, setPlaced] = useState(false);

  useLayoutEffect(() => {
    const el = selector ? container?.querySelector<HTMLElement>(selector) : null;
    if (!container || !el) {
      setBox(null);
      return;
    }
    setBox({ top: el.offsetTop, left: el.offsetLeft, width: el.offsetWidth, height: el.offsetHeight });
    // 行高/文案变化（换语言、标题折行、窗口变宽）会让选中行挪位或变高——见坑 ②
    const ro = new ResizeObserver(() => {
      const cur = container.querySelector<HTMLElement>(selector!);
      if (!cur) return;
      setBox({ top: cur.offsetTop, left: cur.offsetLeft, width: cur.offsetWidth, height: cur.offsetHeight });
    });
    ro.observe(container);
    ro.observe(el);
    return () => ro.disconnect();
  }, [container, selector]);

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
