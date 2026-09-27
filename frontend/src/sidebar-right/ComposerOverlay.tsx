// 浏览器页之上那颗**悬浮对话卡**（壳侧透明叠加层里那一页）。
//
// 浏览器页是壳的原生 WKWebView，HTML 不能浮到它上面；壳在浏览器视图之上再叠一层
// 透明 WKWebView。这一层只负责合成位置和命中测试，卡片自身使用高遮盖率的浮层表面，
// 不依赖跨 WKWebView 的 backdrop-filter 读取网页背景。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Composer } from "../components/Composer";
import { TurnTail } from "./TurnTail";
import { inShell, installHostBridge, onHostEvent, sendToShell } from "../host";
import { useT } from "../i18n";
import { sessionTitle } from "../session/sessionTitle";
import { StoreProvider, useStore } from "../store";

const CARD_WIDTH = 440;
const CARD_HEIGHT = 620;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 320;
const MARGIN = 24;

interface Point { x: number; y: number }
interface Size { w: number; h: number }
interface Layout { x: number; y: number; w: number; h: number }

function layoutKey(sessionId: string): string { return `deepdive.chat-float.${sessionId}`; }

function clampSize(size: Size): Size {
  const maxW = Math.max(MIN_WIDTH, window.innerWidth - MARGIN * 2);
  const maxH = Math.max(MIN_HEIGHT, window.innerHeight - MARGIN * 2);
  return { w: Math.min(Math.max(MIN_WIDTH, size.w), maxW), h: Math.min(Math.max(MIN_HEIGHT, size.h), maxH) };
}

function clamp(p: Point, size: Size): Point {
  const maxX = Math.max(MARGIN, window.innerWidth - size.w - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - size.h - MARGIN);
  return { x: Math.min(Math.max(MARGIN, p.x), maxX), y: Math.min(Math.max(MARGIN, p.y), maxY) };
}

/** 右下角默认位（首次打开用；也用于夹住窗口变小后的旧位置）。 */
function defaultPos(size: Size): Point {
  return clamp({ x: window.innerWidth - size.w - MARGIN, y: window.innerHeight - size.h - MARGIN }, size);
}

function ChatFloatCard({ sessionId }: { sessionId: string }) {
  const { t, lang } = useT();
  const store = useStore();
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [closed, setClosed] = useState(false);
  // 左上角是**会话标题**：走全项目唯一的标题回退（投影标题 → 新会话 → 任务 {id6}）
  const summary = store.sessions.find((it) => it.sessionId === sessionId) ?? store.allSessions.find((it) => it.sessionId === sessionId);
  const title = summary ? sessionTitle(summary, lang) : t("对话");

  // 位置与大小：先读上次的（按会话存），没有就右下角默认尺寸。读到的值也按当前可用空间
  // 夹一次——窗口变小后旧值可能已经出界。
  useLayoutEffect(() => {
    const raw = localStorage.getItem(layoutKey(sessionId));
    let saved: Partial<Layout> | null = null;
    if (raw) {
      try { saved = JSON.parse(raw) as Partial<Layout>; } catch { /* 坏值/旧格式：当没存过 */ }
    }
    const size = clampSize({ w: saved?.w ?? CARD_WIDTH, h: saved?.h ?? CARD_HEIGHT });
    const pos = clamp({ x: saved?.x ?? Number.NaN, y: saved?.y ?? Number.NaN }, size);
    setLayout({
      x: Number.isFinite(pos.x) ? pos.x : defaultPos(size).x,
      y: Number.isFinite(pos.y) ? pos.y : defaultPos(size).y,
      ...size,
    });
  }, [sessionId]);

  // 位置/大小落盘走 250ms 防抖（与会话草稿同一条写法）：拖动过程中每帧 setState，
  // 收尾那次在 pointerup 里读到的还是上一帧的闭包值（实测存下来比实际小 2px）。
  useEffect(() => {
    if (layout === null) return;
    const timer = window.setTimeout(() => localStorage.setItem(layoutKey(sessionId), JSON.stringify(layout)), 250);
    return () => window.clearTimeout(timer);
  }, [layout, sessionId]);

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
  }, [report, layout]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 按在关闭钮上不算拖动：一旦 setPointerCapture 到标题栏，click 就落在标题栏上，
    // 关闭钮的 onClick 永远收不到（实测点了不关）。
    if ((e.target as HTMLElement).closest(".chat-float-close")) return;
    if (!layout) return;
    dragRef.current = { dx: e.clientX - layout.x, dy: e.clientY - layout.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !layout) return;
    const next = { ...layout, ...clamp({ x: e.clientX - drag.dx, y: e.clientY - drag.dy }, layout) };
    setLayout(next);
    report();
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // 右下角把手：拖动改大小，位置跟着夹一次（放大后可能超出可用空间）
  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!layout) return;
    resizeRef.current = { x: e.clientX, y: e.clientY, w: layout.w, h: layout.h };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const from = resizeRef.current;
    if (!from || !layout) return;
    const size = clampSize({ w: from.w + (e.clientX - from.x), h: from.h + (e.clientY - from.y) });
    setLayout({ ...clamp({ x: layout.x, y: layout.y }, size), ...size });
    report();
  };
  const onResizeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const close = () => {
    setClosed(true);
    // 收起整层：卡不在了就不该再吃点击（壳那边 hide 会把可点矩形清零）
    sendToShell({ type: "composer-overlay", sessionId: null });
  };

  if (closed || layout === null) return <div className="chat-float-layer" ref={rootRef} />;

  return (
    <div className="chat-float-layer">
      <div className="chat-float" ref={rootRef} style={{ left: layout.x, top: layout.y, width: layout.w, height: layout.h }}>
        <div
          className="chat-float-head"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <span className="chat-float-title" title={title}>{title}</span>
          <button type="button" className="chat-float-close" aria-label={t("关闭")} onClick={close}>
            <X size={14} />
          </button>
        </div>
        <div className="chat-float-body">
          <TurnTail sessionId={sessionId} />
        </div>
        <div className="chat-float-foot">
          <Composer sessionId={sessionId} />
          <div
            className="chat-float-resize"
            role="separator"
            aria-label={t("调整大小")}
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
          />
        </div>
      </div>
    </div>
  );
}

/** 叠加层入口（main.tsx 在 `?composer=<sid>` 时只挂这一支）。 */
export function ComposerOverlayApp({ sessionId }: { sessionId: string }) {
  useEffect(() => installHostBridge(), []);
  return (
    <StoreProvider>
      <ChatFloatCard sessionId={sessionId} />
    </StoreProvider>
  );
}
