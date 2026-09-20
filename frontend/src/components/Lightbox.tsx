// Lightbox（阶段 2.4/3.2）：点击消息流/附件 chip 里的图片放大展示的全屏浮层。
// Esc/点击空白/右上角关闭钮关闭；经 Portal 挂 body——消息子树上的动画
// transform 会把 position:fixed 困进祖先 containing block（实测 188×137
// 贴着缩略图），Portal 是唯一可靠出口。不管图片来源与加载，只管放大呈现。
// 缩放：打开按视口适配（100% = 原图像素），底部胶囊 − / 百分比 / + 调档，点百分比
// 回 100%；⌘/⌃+滚轮（触控板捏合）以画面中心为不动点缩放，拖拽或滚动平移。

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.25;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
/** 适配视口的倍率：留 6% 呼吸边，与旧版 max-width/height: 94vw/vh 同口径。 */
const fitScale = (n: { w: number; h: number }, v: { w: number; h: number }) =>
  Math.min(1, (v.w * 0.94) / n.w, (v.h * 0.94) / n.h);

export function Lightbox({ src, alt, onClose }: { src: string; alt?: string; onClose: () => void }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  /** 上一次的适配倍率（视口变化时判断当前是否处于适配态）。 */
  const fitRef = useRef(1);
  /** 刚发生过拖拽平移：抑制这一下点击的"点空白关闭"。 */
  const draggedRef = useRef(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [zoom, setZoomState] = useState(1);
  zoomRef.current = zoom;

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 视口变化重算适配倍率：当前正处在适配态就跟着变，用户手动缩放过的不动
  useEffect(() => {
    if (!natural) return;
    const fit = fitScale(natural, viewport);
    setZoomState((z) => (Math.abs(z - fitRef.current) < 1e-6 ? fit : z));
    fitRef.current = fit;
  }, [natural, viewport]);

  /** 改倍率：以画面中心为不动点，缩放后把同一画面点摆回原位置。 */
  const setZoom = (next: number) => {
    const body = bodyRef.current;
    const clamped = clampZoom(next);
    if (!body || clamped === zoomRef.current) { setZoomState(clamped); return; }
    const cx = (body.scrollLeft + body.clientWidth / 2) / zoomRef.current;
    const cy = (body.scrollTop + body.clientHeight / 2) / zoomRef.current;
    setZoomState(clamped);
    requestAnimationFrame(() => {
      body.scrollLeft = cx * clamped - body.clientWidth / 2;
      body.scrollTop = cy * clamped - body.clientHeight / 2;
    });
  };

  // ⌘/⌃+滚轮缩放（触控板捏合在 WebKit 就是 ctrl+wheel）：必须原生非 passive 监听，
  // React 的 onWheel 挂了 passive，preventDefault 静默失效。
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // 普通滚动＝平移，交给容器自己滚
      e.preventDefault();
      setZoom(zoomRef.current * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
    };
    body.addEventListener("wheel", onWheel, { passive: false });
    return () => body.removeEventListener("wheel", onWheel);
  }, []); // setZoom 只经 ref 读当前倍率，重挂无意义

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") setZoom(zoomRef.current * ZOOM_STEP);
      else if (e.key === "-" || e.key === "_") setZoom(zoomRef.current / ZOOM_STEP);
      else if (e.key === "0") setZoom(1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]); // 倍率经 zoomRef 读，不随它重挂

  /** 按住拖拽平移（放大到超出视口时用）；位移超过阈值即不算"点击"。 */
  const onMouseDown = (e: React.MouseEvent) => {
    const body = bodyRef.current;
    if (!body) return;
    draggedRef.current = false;
    const start = { x: e.clientX, y: e.clientY, left: body.scrollLeft, top: body.scrollTop };
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) draggedRef.current = true;
      body.scrollLeft = start.left - dx;
      body.scrollTop = start.top - dy;
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return createPortal(
    <div
      className="lightbox"
      role="dialog"
      aria-label={alt || "image"}
      onClick={() => { if (!draggedRef.current) onClose(); }}
    >
      <div className="lightbox-body" ref={bodyRef} onMouseDown={onMouseDown}>
        <img
          src={src}
          alt={alt ?? ""}
          draggable={false}
          data-zoomed={natural ? "" : undefined}
          onLoad={(e) => {
            const el = e.currentTarget;
            const size = { w: el.naturalWidth, h: el.naturalHeight };
            const fit = fitScale(size, { w: window.innerWidth, h: window.innerHeight });
            fitRef.current = fit;
            setNatural(size);
            setZoomState(fit);
          }}
          style={natural ? { width: Math.max(1, Math.round(natural.w * zoom)) } : undefined}
        />
      </div>
      {/* 缩放胶囊：配色与关闭钮同语言（叠在任意亮度的图上，不随主题） */}
      <div className="lightbox-zoom" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" aria-label={t("缩小")} onClick={() => setZoom(zoom / ZOOM_STEP)}>−</button>
        <button
          type="button"
          className="lightbox-zoom-value"
          onClick={() => setZoom(1)}
          data-tip={t("恢复 100%")}
        >{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label={t("放大")} onClick={() => setZoom(zoom * ZOOM_STEP)}>+</button>
      </div>
      <button
        className="lightbox-close"
        aria-label={t("关闭")}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >×</button>
    </div>,
    document.body,
  );
}
