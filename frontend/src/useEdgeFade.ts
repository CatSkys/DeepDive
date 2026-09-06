import { useLayoutEffect, useState } from "react";

// 溢出渐隐边缘（超限标准 UI 显示）的信号侧：滚动容器有内容被藏住、且未
// 滚到对应边缘时，该侧渐隐提示「后面还有」。样式侧是 theme.css 末尾的
// .fade-x / .fade-y 工具类（mask-image），本文件只负责测量与 data 属性。
// 接线：const fade = useEdgeFade([deps]); <div ref={fade.ref} {...fadeAttrs(fade.fade)} />
// 需要和其他 ref 回调聚合时，把 fade.ref 写进自定义回调即可。

export interface EdgeFadeState { start: boolean; end: boolean; }

/** data 属性包：false 时丢键，CSS 按 [data-fade-*] 存在性匹配。 */
export function fadeAttrs(fade: EdgeFadeState): {
  "data-fade-start"?: string;
  "data-fade-end"?: string;
} {
  return {
    "data-fade-start": fade.start ? "" : undefined,
    "data-fade-end": fade.end ? "" : undefined,
  };
}

/** 横竖滚动容器通用：没有溢出的一轴两项恒 false。四路触发：scroll、
 *  ResizeObserver（容器自身尺寸）、MutationObserver（子树增删——会话行/
 *  格子增减不改容器尺寸，RO 看不见；只听 childList，轮询改时间戳这类
 *  文字变更不触发）、元素重造（callback ref 换新即重挂）。1px 容差抗亚
 *  像素抖动；值不变时回传原引用避免滚动中的多余渲染。 */
export function useEdgeFade<E extends HTMLElement = HTMLDivElement>(): {
  ref: (el: E | null) => void;
  fade: EdgeFadeState;
} {
  const [el, setEl] = useState<E | null>(null);
  const [fade, setFade] = useState<EdgeFadeState>({ start: false, end: false });
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      const next = {
        start: el.scrollTop > 1 || el.scrollLeft > 1,
        end: el.scrollHeight - el.scrollTop - el.clientHeight > 1
          || el.scrollWidth - el.scrollLeft - el.clientWidth > 1,
      };
      setFade((p) => (p.start === next.start && p.end === next.end ? p : next));
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
      mo.disconnect();
    };
  }, [el]);
  return { ref: setEl, fade };
}
