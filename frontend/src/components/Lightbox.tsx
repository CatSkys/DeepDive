import { useEffect } from "react";

// Lightbox（阶段 2.4/3.2）：点击消息流中的图片放大展示的全屏浮层。
// Esc/点击空白关闭；不管图片来源与加载，只管放大呈现。

export function Lightbox({ src, alt, onClose }: { src: string; alt?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-label={alt || "image"}>
      <img src={src} alt={alt ?? ""} />
    </div>
  );
}
