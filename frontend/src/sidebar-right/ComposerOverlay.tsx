// 浏览器页之上那颗**悬浮对话卡**（壳侧透明叠加层里渲染的那一页）。
//
// 为什么是"壳里再叠一个 webview"而不是把 HTML 浮上去：浏览器页是壳的原生 WKWebView，
// **恒画在 SPA 的 HTML 之上**（缩略图蒙层看不见就是这个原因），HTML 浮不到它上面。壳在浏览器
// 视图之上再叠一层**透明** WKWebView，那一层里跑的仍是这份 SPA（同一入口、同一个 Composer
// 组件），所以输入能力与配色不会出现第二份实现。
//
// 这一页只有一张卡：标题栏（可拖动 + 右上关闭）／本轮内容（同一个 TurnTail）／输入框
// （同一个 Composer）。卡片位置按会话存在 localStorage；拖动时把新矩形报给壳——壳按
// "卡片矩形"做 hitTest，卡外一律透传给底下的网页。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Composer } from "../components/Composer";
import { TurnTail } from "./TurnTail";
import { inShell, onHostEvent, sendToShell } from "../host";
import { useT } from "../i18n";
import { StoreProvider } from "../store";

const CARD_WIDTH = 380;
const CARD_HEIGHT = 520;
const MARGIN = 24;

interface Point { x: number; y: number }

function posKey(sessionId: string): string { return `deepdive.chat-float.${sessionId}`; }

function clamp(p: Point, w: number, h: number): Point {
  const maxX = Math.max(MARGIN, window.innerWidth - w - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - h - MARGIN);
  return { x: Math.min(Math.max(MARGIN, p.x), maxX), y: Math.min(Math.max(MARGIN, p.y), maxY) };
}

/** 右下角默认位（首次打开用；也用于夹住窗口变小后的旧位置）。 */
function defaultPos(w: number, h: number): Point {
  return clamp({ x: window.innerWidth - w - MARGIN, y: window.innerHeight - h - MARGIN }, w, h);
}

function ChatFloatCard({ sessionId }: { sessionId: string }) {
  const { t } = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState<Point | null>(null);
  const [closed, setClosed] = useState(false);

  // 位置：先读上次的（按会话存），没有就右下角。读到的值也按当前可用空间夹一次——
  // 窗口变小后旧位置可能已经出界。
  useLayoutEffect(() => {
    const raw = localStorage.getItem(posKey(sessionId));
    let saved: Point | null = null;
    if (raw) {
      try { saved = JSON.parse(raw) as Point; } catch { /* 坏值/旧格式：当没存过，用默认位 */ }
    }
    setPos(clamp(saved ?? defaultPos(CARD_WIDTH, CARD_HEIGHT), CARD_WIDTH, CARD_HEIGHT));
  }, [sessionId]);

  // 壳说"把卡片叫出来"（浏览器顶栏那颗「对话」按钮）——关掉之后再点要能回来。
  useEffect(() => onHostEvent((cmd) => {
    if (cmd === "chatShow") setClosed(false);
  }), []);

  // 卡片矩形报给壳：壳按它做 hitTest，卡外一律透传给网页。拖动/窗口变化都要跟上。
  const report = useCallback(() => {
    if (!inShell() || closed) return;
    const box = rootRef.current;
    if (!box) return;
    const r = box.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    sendToShell({ type: "composer-pill", rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
  }, [closed]);

  useLayoutEffect(() => {
    report();
    const timer = window.setInterval(report, 300);
    window.addEventListener("resize", report);
    return () => { window.clearInterval(timer); window.removeEventListener("resize", report); };
  }, [report, pos]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 按在关闭钮上不算拖动：一旦 setPointerCapture 到标题栏，click 就落在标题栏上，
    // 关闭钮的 onClick 永远收不到（实测点了不关）。
    if ((e.target as HTMLElement).closest(".chat-float-close")) return;
    if (!pos) return;
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPos(clamp({ x: e.clientX - drag.dx, y: e.clientY - drag.dy }, CARD_WIDTH, CARD_HEIGHT));
    report();
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (pos) localStorage.setItem(posKey(sessionId), JSON.stringify(pos));
  };

  const close = () => {
    setClosed(true);
    // 收起整层：卡不在了就不该再吃点击（壳那边 hide 会把可点矩形清零）
    sendToShell({ type: "composer-overlay", sessionId: null });
  };

  if (closed || pos === null) return <div className="chat-float-layer" ref={rootRef} />;

  return (
    <div className="chat-float-layer">
      <div className="chat-float" ref={rootRef} style={{ left: pos.x, top: pos.y, width: CARD_WIDTH, height: CARD_HEIGHT }}>
        <div
          className="chat-float-head"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <span className="chat-float-title">{t("对话")}</span>
          <button type="button" className="chat-float-close" aria-label={t("关闭")} onClick={close}>
            <X size={14} />
          </button>
        </div>
        <div className="chat-float-body">
          <TurnTail sessionId={sessionId} />
        </div>
        <div className="chat-float-foot">
          <Composer sessionId={sessionId} />
        </div>
      </div>
    </div>
  );
}

/** 叠加层入口（main.tsx 在 `?composer=<sid>` 时只挂这一支）。 */
export function ComposerOverlayApp({ sessionId }: { sessionId: string }) {
  return (
    <StoreProvider>
      <ChatFloatCard sessionId={sessionId} />
    </StoreProvider>
  );
}
