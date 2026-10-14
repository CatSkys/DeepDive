// 附件胶囊：**输入框里的行内原子**与会话里用户消息带的附件是**同一颗**（用户 2026-10-14
// 定稿："把会话中用户消息带的媒体文件也都改成胶囊，保持统一"）。形状：类型图标 + 名字 +
// 可选的状态一截 + 可选的重试/移除钮；媒体（图片/视频）悬停出预览画面。
//
// 纯呈现，**不读任何 context**：输入框那颗作为行内原子画在编辑器自己的 React 根里
// （没有外层 Provider，`useT` 会炸——见 PITFALLS §8.7），所以词典 `t` 也由调用方给。
// 同理，字节从哪儿来、点开做什么都由调用方给：输入框拿手里的附件对象，消息侧拿拉回来的字节。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileIcon } from "../session/FileIcon";

/** 预览画面**可能**占的最大高度、与它到胶囊的缝：与 .att-preview 的 max-height / 6px 同值。
 *  只用来判「胶囊下方放不放得下」——按最大可能值判，宁可多翻一次也不摆一半。 */
const PREVIEW_MAX_H = 160;
const PREVIEW_GAP = 6;

/** 附件状态：只用来上样式（待发送/上传中整颗淡一点、失败描红字）。 */
export type PillStatus = "pending" | "uploading" | "ready" | "error";

export interface AttachmentPillProps {
  name: string;
  /** 图标档位：附件的**图片部件**直接给 "image"（名字没有扩展名也画图片图标）；
   *  文件按名字的类型图标画。 */
  icon: "image" | "file";
  /** 名字右边那一截（上传中 42% / 失败原因原话 / 大小）；空就不摆。 */
  meta?: string;
  status?: PillStatus;
  /** 正在上传：图标位换成转圈。 */
  busy?: boolean;
  /** 名字右侧的 tooltip：给展不开的原话（失败原因）。 */
  tip?: string;
  /** 悬停时画的画面（媒体才有）。字节的建/撤由调用方按 `onHoverChange` 的信号自己做
   *  （图片附件的字节一直在内存里、文件附件的 blob URL 要在悬停时才建）。 */
  preview?: { src: string; video: boolean } | null;
  t: (zh: string) => string;
  /** 点胶囊（图片/视频开大图）。不给就不可点。 */
  onOpen?: () => void;
  /** 失败态那颗「重试」（只有输入框里才有）。 */
  onRetry?: () => void;
  /** 移除钮（只有输入框里才有；消息里那颗删不掉）。 */
  onRemove?: () => void;
  /** 悬停进出：调用方据此建/撤预览画面用的字节。 */
  onHoverChange?: (hovering: boolean) => void;
}

export function AttachmentPill({
  name, icon, meta, status, busy, tip, preview, t, onOpen, onRetry, onRemove, onHoverChange,
}: AttachmentPillProps) {
  /** 悬停时画面开在哪儿（视口坐标）；null = 没在悬停。**走 portal 画在 body 上**：
   *  输入框那颗住在编辑器的滚动容器里，绝对定位的子元素会被那个容器裁掉（画面比胶囊高得多）。 */
  /** 锚点二选一：下方那档钉 top（胶囊底 + 缝），上方那档钉 bottom（视口底到胶囊顶 - 缝）——
   *  画面多高要等渲染出来才知道，钉 top 会把整块盖在输入框上。 */
  const [box, setBox] = useState<{ left: number; above: boolean; top?: number; bottom?: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const hovering = box !== null;

  // 进场位置在悬停那一刻量：贴底时下方放不下就翻到上方（否则整块被内容卡裁掉）
  const enter = () => {
    const el = ref.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    const above = window.innerHeight - rect.bottom < PREVIEW_MAX_H + PREVIEW_GAP * 2;
    setBox(above
      ? { left: rect.left, above, bottom: window.innerHeight - rect.top + PREVIEW_GAP }
      : { left: rect.left, above, top: rect.bottom + PREVIEW_GAP });
    onHoverChange?.(true);
  };
  const leave = () => {
    setBox(null);
    onHoverChange?.(false);
  };
  // 卸载时把"悬停中"报回去（胶囊在悬停中被删掉时，调用方那份状态不该留着）
  const hoverRef = useRef(onHoverChange);
  hoverRef.current = onHoverChange;
  useEffect(() => () => { hoverRef.current?.(false); }, []);

  return (
    <span
      ref={ref}
      className="att-chip"
      data-open={onOpen ? "lightbox" : undefined}
      /* 只有带移除钮的那颗才在悬停时给钮让位（消息里那颗没有钮、内容不该被裁） */
      data-removable={onRemove ? "true" : undefined}
      data-status={status}
      data-tip={tip}
      onMouseEnter={onOpen || preview ? enter : undefined}
      onMouseLeave={onOpen || preview ? leave : undefined}
      onClick={onOpen}
    >
      {/* 内容（图标 + 名 + 状态）：平时**铺满整颗**；带移除钮的那颗悬停时右侧裁掉一条
          给钮让位（样式在 theme.css 的 .att-chip[data-removable]:hover .att-chip-body） */}
      <span className="att-chip-body">
        {busy
          ? <span className="att-chip-spin" aria-hidden="true" />
          : <FileIcon file={name} size={14} icon={icon === "image" ? "image" : undefined} />}
        <span className="att-chip-name">{name}</span>
        {meta ? <span className={`att-chip-meta${status === "error" ? " failed" : ""}`}>{meta}</span> : null}
        {status === "error" && onRetry && (
          <button className="att-chip-retry" onClick={(e) => { e.stopPropagation(); onRetry(); }}>{t("重试")}</button>
        )}
      </span>
      {onRemove && (
        <button
          className="att-chip-x"
          aria-label={t("删除")}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >×</button>
      )}
      {preview && hovering && box !== null && createPortal(
        <span
          className={`att-preview${box.above ? " above" : ""}`}
          style={{ left: box.left, top: box.top, bottom: box.bottom }}
          aria-hidden="true"
        >
          {/* 视频取首帧当画面：`#t=0.001` 让 WebKit 落一帧 */}
          {preview.video
            ? <video src={`${preview.src}#t=0.001`} preload="metadata" muted playsInline />
            : <img src={preview.src} alt="" />}
        </span>,
        document.body,
      )}
    </span>
  );
}
