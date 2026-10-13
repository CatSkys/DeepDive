// 图表悬浮提示：portal 到 body 的 fixed 定位（不随卡片 overflow 裁剪），
// 默认悬在指针上方居中，越界时夹回视口内。内容随 tip.x/y 每次移动重算。
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import css from "./UsageSection.module.css";
import { GlassLayer } from "../components/GlassLayer";

export interface ChartTipState {
  x: number;
  y: number;
  content: ReactNode;
}

export function ChartTip({ tip }: { tip: ChartTipState | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [off, setOff] = useState({ dx: 0, dy: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const r = el.getBoundingClientRect();
    let dx = -r.width / 2;
    let dy = -r.height - 12;
    const left = tip.x + dx;
    if (left < 8) dx += 8 - left;
    if (left + r.width > window.innerWidth - 8) dx -= left + r.width - (window.innerWidth - 8);
    if (tip.y + dy < 8) dy = 16;
    setOff((o) => (o.dx === dx && o.dy === dy ? o : { dx, dy }));
  }, [tip]);
  if (!tip) return null;
  return createPortal(
    <div ref={ref} className={css.tip} style={{ left: tip.x + off.dx, top: tip.y + off.dy }}>
                   <GlassLayer />
      {tip.content}
    </div>,
    document.body,
  );
}
