import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// 全局悬浮注释（替代原生 title）：任意元素加
//   data-tip="文案"  data-tip-keys="⌘,"（右侧键帽快捷键，可省）
//   data-tip-pos="top|bottom|left|right"（缺省 top，空间不足自动翻转到对侧）
// 注释与触发元素四边对齐并夹在视口内；悬停立即弹出，沿来源方向滑动入场；
// 滚动/按下/移出即收。目标元素从 DOM 移除时 mouseout 不会触发（偶发不消失
// 的根因），可见期以 400ms 轮询校验连接性与 ：hover/:focus 兜底隐藏。

type Pos = "top" | "bottom" | "left" | "right";
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
  const current = useRef<HTMLElement | null>(null);

  const hide = useCallback(() => {
    current.current = null;
    setTip(null);
    setPlaced(null);
  }, []);

  useEffect(() => {
    const over = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (!el) return;
      if (el === current.current) return;
      current.current = el;
      setTip({
        el,
        text: el.dataset.tip ?? "",
        keys: el.dataset.tipKeys || undefined,
        pos: (el.dataset.tipPos as Pos) || "top",
      });
      setPlaced(null); // 渲染后测量再落位
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
    };
  }, [hide]);

  // 兜底巡检：目标已脱离文档、或指针/焦点已不在其上（重渲染吞掉
  // mouseout 的场景）→ 收起。轮询只在注释可见期间运行/卸载（AUD-040：
  // 曾挂在 mount effect 常开，无 tip 也每 400ms 校验一次）。
  useEffect(() => {
    if (!tip) return;
    const watch = setInterval(() => {
      const el = current.current;
      if (el && el.isConnected && el.matches(":hover, :focus")) return;
      hide();
    }, 400);
    return () => clearInterval(watch);
  }, [tip, hide]);

  // 渲染后按实测尺寸落位：先按偏好边对齐，空间不足翻转到对侧，再夹进视口
  useLayoutEffect(() => {
    if (!tip || !boxRef.current) return;
    const b = boxRef.current.getBoundingClientRect();
    const r = tip.el.getBoundingClientRect();
    let pos = tip.pos;
    const fits = (p: Pos) => {
      if (p === "top") return r.top - b.height - GAP >= MARGIN;
      if (p === "bottom") return window.innerHeight - r.bottom - b.height - GAP >= MARGIN;
      if (p === "left") return r.left - b.width - GAP >= MARGIN;
      return window.innerWidth - r.right - b.width - GAP >= MARGIN;
    };
    const flip: Record<Pos, Pos> = { top: "bottom", bottom: "top", left: "right", right: "left" };
    if (!fits(pos)) pos = flip[pos];
    let top: number;
    let left: number;
    if (pos === "top") {
      top = r.top - b.height - GAP;
      left = r.left + r.width / 2 - b.width / 2;
    } else if (pos === "bottom") {
      top = r.bottom + GAP;
      left = r.left + r.width / 2 - b.width / 2;
    } else if (pos === "left") {
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
