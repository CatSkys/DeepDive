// 输入框里的附件胶囊：图片与文件**同一个形状**（类型图标 + 名字 + 状态 + 移除），
// 媒体附件（图片/视频）悬停出预览画面。
// 只管这一颗怎么画、预览开在哪；移除/重试/打开大图三个动作经 props 交回 Composer
// ——附件集合与上传状态机都在它那儿。
import { useEffect, useRef, useState } from "react";
import { FileIcon } from "../../session/FileIcon";
import { resolveFileIconName } from "../../session/fileIcons";
import { useT } from "../../i18n";
import { fileMeta } from "./fileMeta";
import type { Attachment, ImageAttachment } from "./useComposerAttachments";

/** 预览画面的最大高度与它到胶囊的缝：与 .att-preview 的 max-height / 6px 同值——
 *  只用来判「胶囊下方放不放得下」。 */
const PREVIEW_MAX_H = 180;
const PREVIEW_GAP = 6;

/** 媒体判据（图片/视频）：图标名表就是单一事实源，与已发送侧同一口径
 *  （.user-attachment-thumb 只给这两类出缩略图）。其余文件（pdf/zip/文本…）没有
 *  画面可预览，悬停不弹东西——用户定稿"仅限媒体文件"。 */
function mediaOf(name: string): "image" | "video" | null {
  const icon = resolveFileIconName(name);
  return icon === "image" || icon === "video" ? icon : null;
}

/** 预览画面的字节来源。图片附件的字节一直在内存里（data URL）；文件附件的字节只有
 *  本端手里这一份（文件部件的字节引擎拿不回来，见 session/localMedia.ts），有 File
 *  才建 blob URL、收起即撤。壳选择器挑来的文件只有路径、没有字节——那种不弹预览框
 *  （宁可没有，也不摆一块空白）。 */
function usePreviewSrc(att: Attachment, active: boolean): string | null {
  const [src, setSrc] = useState<string | null>(null);
  const data = att.kind === "image" ? att.data : null;
  const mediaType = att.kind === "image" ? att.mediaType : null;
  const file = att.kind === "file" ? att.file : undefined;
  useEffect(() => {
    if (!active) {
      setSrc(null);
      return;
    }
    if (data !== null && mediaType !== null) {
      setSrc(`data:${mediaType};base64,${data}`);
      return;
    }
    if (!file) {
      setSrc(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [active, data, mediaType, file]);
  return src;
}

export function AttachmentPill({ att, onRemove, onRetry, onOpenImage }: {
  att: Attachment;
  /** 摘掉这颗：上传中的先取消（见 Composer 的 removeAttachment）。 */
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  /** 图片附件点开 Lightbox 放大（与已发送侧同一动作）。 */
  onOpenImage: (att: ImageAttachment) => void;
}) {
  const { t } = useT();
  const [hover, setHover] = useState(false);
  /** 预览开在胶囊上方（下方放不下时）。 */
  const [above, setAbove] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  /** 预览画面按哪一档画：图片部件一定是图片（名字没扩展名也算），其余看名字。 */
  const picture = att.kind === "image" ? "image" : mediaOf(att.name);
  /** 点得开 Lightbox 的只有图片部件——它的字节（data URL）一直在，关掉预览也不失效；
   *  文件附件的 blob URL 只活到指针离开，不能交给 Lightbox。 */
  const openable = att.kind === "image";
  const src = usePreviewSrc(att, hover && picture !== null);
  const meta = att.kind === "file" ? fileMeta(att, t) : null;

  return (
    <span
      ref={ref}
      className="att-chip"
      data-open={openable ? "lightbox" : undefined}
      data-status={att.kind === "file" ? att.status : undefined}
      data-tip={att.kind === "file" ? att.error : undefined}
      onMouseEnter={() => {
        const el = ref.current;
        // 输入框贴底时胶囊下方只有十几像素：放不下就翻到上方，否则整块被内容卡裁掉
        if (el) setAbove(window.innerHeight - el.getBoundingClientRect().bottom < PREVIEW_MAX_H + PREVIEW_GAP * 2);
        setHover(true);
      }}
      onMouseLeave={() => setHover(false)}
      onClick={openable ? () => onOpenImage(att) : undefined}
    >
      {att.kind === "file" && att.status === "uploading"
        ? <span className="att-chip-spin" aria-hidden="true" />
        : <FileIcon file={att.name} size={14} icon={att.kind === "image" ? "image" : undefined} />}
      <span className="att-chip-name">{att.name}</span>
      {meta !== null && <span className={`att-chip-meta${att.kind === "file" && att.status === "error" ? " failed" : ""}`}>{meta}</span>}
      {att.kind === "file" && att.status === "error" && (
        <button className="att-chip-retry" onClick={(e) => { e.stopPropagation(); onRetry(att.id); }}>{t("重试")}</button>
      )}
      <button
        className="att-chip-x"
        aria-label={t("删除")}
        onClick={(e) => { e.stopPropagation(); onRemove(att.id); }}
      >×</button>
      {src && (
        <span className={`att-preview${above ? " above" : ""}`} aria-hidden="true">
          {/* 视频取首帧当画面：`#t=0.001` 让 WebKit 落一帧（与已发送侧缩略图同一招） */}
          {picture === "video"
            ? <video src={`${src}#t=0.001`} preload="metadata" muted playsInline />
            : <img src={src} alt="" />}
        </span>
      )}
    </span>
  );
}
