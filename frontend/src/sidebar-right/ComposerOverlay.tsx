// 浏览器全屏时的**悬浮输入框**（壳侧透明叠加层里渲染的那一页）。
//
// 为什么是"壳里再叠一个 webview"而不是把 HTML 浮上去：浏览器页是壳的原生 WKWebView，
// **恒画在 SPA 之上**（缩略图那层蒙层看不见就是这个原因），HTML 浮不到它上面。壳在浏览器
// 视图之上再叠一层**透明** WKWebView，那一层里跑的仍是这份 SPA（同一入口、同一个 Composer
// 组件），所以输入能力（@ 引用 / 命令 / 附件 / 听写 / 排队 / 多行卡片）与配色都不会出现
// 第二份实现——这正是用户要的"原样复用会话输入框"。
//
// 这一页只做三件事：透明背景、输入框上方一条「已工作 x」、下面原样的 Composer；并把
// **可点区域**（那颗胶囊）的 rect 报给壳——胶囊之外要透传点击/滚轮给底下的网页。
import { useLayoutEffect, useRef } from "react";
import { Composer } from "../components/Composer";
import { TurnTail } from "./TurnTail";
import { sendToShell } from "../host";
import { inShell } from "../host";
import { StoreProvider } from "../store";

function ComposerOverlayRoot({ sessionId }: { sessionId: string }) {
  const rootRef = useRef<HTMLDivElement>(null);

  // 可点区域 = 那张"最近一轮"卡片 + 输入框。壳按它做 hitTest：之外的点透传给网页，
  // 否则透明区会吞掉页面的点击与滚轮。
  useLayoutEffect(() => {
    if (!inShell()) return;
    const push = () => {
      const box = rootRef.current;
      if (!box) return;
      // 只有"卡片 + 输入框"这块收事件：容器是整条透明带（inset:0），报整条会把网页
      // 在带内的点击与滚轮全吞掉。
      const parts = [".composer-float-tail", ".composer"]
        .map((sel) => box.querySelector(sel)?.getBoundingClientRect())
        .filter((r): r is DOMRect => !!r && r.width > 0 && r.height > 0);
      if (parts.length === 0) return;
      const left = Math.min(...parts.map((r) => r.left));
      const right = Math.max(...parts.map((r) => r.right));
      const top = Math.min(...parts.map((r) => r.top));
      const bottom = Math.max(...parts.map((r) => r.bottom));
      sendToShell({ type: "composer-pill", rect: { x: left, y: top, w: right - left, h: bottom - top } });
    };
    push();
    const timer = window.setInterval(push, 300);
    window.addEventListener("resize", push);
    return () => { window.clearInterval(timer); window.removeEventListener("resize", push); };
  }, []);

  return (
    <div className="composer-float" ref={rootRef}>
      <TurnTail sessionId={sessionId} />
      <Composer sessionId={sessionId} />
    </div>
  );
}

/** 叠加层入口（main.tsx 在 `?composer=<sid>` 时只挂这一支）。 */
export function ComposerOverlayApp({ sessionId }: { sessionId: string }) {
  return (
    <StoreProvider>
      <ComposerOverlayRoot sessionId={sessionId} />
    </StoreProvider>
  );
}
