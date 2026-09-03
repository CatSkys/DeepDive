import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// 全局悬浮注释（替代原生 title）：任意元素加
//   data-tip="文案"  data-tip-keys="⌘,"（右侧键帽快捷键，可省）
//   data-tip-pos="top|bottom|left|right"（缺省 top）
// 注释与触发元素四边对齐并夹在视口内；悬停 450ms 弹出（已显示时切换
// 目标立即换内容），沿来源方向滑动入场；滚动/按下/移出即收，防位置漂移。

type Pos = "top" | "bottom" | "left" | "right";
const SHOW_DELAY = 450;
const GAP = 8;
const MARGIN = 8;

interface Tip {
  el: HTMLElement;
  text: string;
  keys?: string;
  pos: Pos;
}

export function TooltipHost() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [placed, setPlaced] = useState<{ top: number; left: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const current = useRef<HTMLElement | null>(null);

  const hide = () => {
    window.clearTimeout(timer.current);
    current.current = null;
    setTip(null);
    setPlaced(null);
  };

  useEffect(() => {
    const show = (el: HTMLElement) => {
      current.current = el;
      setTip({
        el,
        text: el.dataset.tip ?? "",
        keys: el.dataset.tipKeys || undefined,
        pos: (el.dataset.tipPos as Pos) || "top",
      });
      setPlaced(null); // 渲染后测量再落位
    };
    const over = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (!el) return;
      if (el === current.current) return;
      window.clearTimeout(timer.current);
      if (current.current) show(el); // 已在展示：换目标立即切换
      else timer.current = window.setTimeout(() => show(el), SHOW_DELAY);
    };
    const out = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-tip]");
      if (el && el === current.current) hide();
    };
    const down = () => hide();
    const onScroll = () => hide();
    document.addEventListener("mouseover", over);
    document.addEventListener("mouseout", out);
    document.addEventListener("focusin", over);
    document.addEventListener("focusout", out);
    document.addEventListener("mousedown", down);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mouseout", out);
      document.removeEventListener("focusin", over);
      document.removeEventListener("focusout", out);
      document.removeEventListener("mousedown", down);
      window.removeEventListener("scroll", onScroll, true);
      window.clearTimeout(timer.current);
    };
  }, []);

  // 渲染后按实测尺寸落位：四边对齐触发元素并夹在视口内
  useLayoutEffect(() => {
    if (!tip || !boxRef.current) return;
    const b = boxRef.current.getBoundingClientRect();
    const r = tip.el.getBoundingClientRect();
    let top: number;
    let left: number;
    if (tip.pos === "top") {
      top = r.top - b.height - GAP;
      left = r.left + r.width / 2 - b.width / 2;
    } else if (tip.pos === "bottom") {
      top = r.bottom + GAP;
      left = r.left + r.width / 2 - b.width / 2;
    } else if (tip.pos === "left") {
      top = r.top + r.height / 2 - b.height / 2;
      left = r.left - b.width - GAP;
    } else {
      top = r.top + r.height / 2 - b.height / 2;
      left = r.right + GAP;
    }
    setPlaced({
      top: Math.min(Math.max(MARGIN, top), window.innerHeight - b.height - MARGIN),
      left: Math.min(Math.max(MARGIN, left), window.innerWidth - b.width - MARGIN),
    });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={boxRef}
      className="tip"
      data-pos={tip.pos}
      role="tooltip"
      style={placed ? { top: placed.top, left: placed.left } : { visibility: "hidden" }}
    >
      <span className="tip-text">{tip.text}</span>
      {tip.keys && <kbd className="tip-keys">{tip.keys}</kbd>}
    </div>,
    document.body,
  );
}
