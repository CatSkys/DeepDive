// 浏览器浮层仍由原 React 树渲染；同源子窗口仅提供高于原生网页的透明绘制面。
import { useLayoutEffect, useRef, useState } from "react";
import { inShell, sendToShell } from "../host";

export function useBrowserPopup(open: boolean, onDismiss: () => void): HTMLElement | null {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useLayoutEffect(() => {
    if (!open) return;
    if (!inShell()) {
      setTarget(document.body);
      return () => setTarget(null);
    }
    const popup = window.open("about:blank", "deepdive-browser-popup");
    if (!popup) throw new Error("Browser popup host was not created");
    const doc = popup.document;
    doc.documentElement.className = document.documentElement.className;
    for (const attr of document.documentElement.attributes) doc.documentElement.setAttribute(attr.name, attr.value);
    doc.documentElement.dataset.overlay = "1";
    for (const style of document.querySelectorAll('link[rel="stylesheet"], style')) doc.head.append(style.cloneNode(true));
    doc.body.style.background = "transparent";
    const root = doc.createElement("div");
    doc.body.append(root);
    const close = () => dismiss.current();
    popup.addEventListener("deepdive-popup-dismiss", close);
    const update = () => {
      const rects = [...root.children].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      sendToShell({ type: "browser-popup-rects", rects });
    };
    const sizes = new ResizeObserver(update);
    const observer = new MutationObserver(() => {
      for (const child of root.children) sizes.observe(child);
      update();
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true });
    const stylesReady = () => update();
    doc.addEventListener("load", stylesReady, true);
    popup.addEventListener("resize", close);
    setTarget(root);
    return () => {
      observer.disconnect();
      sizes.disconnect();
      doc.removeEventListener("load", stylesReady, true);
      popup.removeEventListener("deepdive-popup-dismiss", close);
      popup.removeEventListener("resize", close);
      popup.close();
      setTarget(null);
    };
  }, [open]);
  return target;
}
