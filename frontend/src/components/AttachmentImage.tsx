import { useEffect, useState } from "react";
import { api } from "../api";
import { Lightbox } from "./Lightbox";
import { AttachmentPill } from "./AttachmentPill";
import { resolveFileIconName } from "../session/fileIcons";
import { sizeText } from "../session/format";
import { localMediaUrl } from "../session/localMedia";
// 词典走模块级的 t（与排队区/插话区同一套）：消息流里这几个组件不保证在
// Provider 里渲染（队列快照也能画），所以不读 context——那一层由 useT 的调用方
// 维护 currentLang（会话页随处都有输入框在渲染）。
import { t } from "../i18n";
import type { ContentBlock } from "../types";

// 用户消息附件（3.2 收尾 + 0.1.5 通用文件）：attachment 引用块的渲染——**一律胶囊**
// （与输入框里那颗同一个组件，用户 2026-10-14 定稿"保持统一"）：图片/视频把字节当
// 悬停预览、点开进 Lightbox；其余通用文件出图标 + 名字 + 大小。
// 字节经 session.attachment 拉取，attachmentId 全局缓存（历史回放与实时帧
// 可能重复出现同一附件）。
// **工具结果的图片不走这里**（AttachmentThumb 的 92×68 缩略图）：那是工具输出的内容，
// 不是用户带的附件。

interface Att {
  attachmentId: string;
  mediaType: string;
  name?: string;
  width?: number;
  height?: number;
  bytes?: number;
}

const BYTES_CACHE_MAX = 24;
const bytesCache = new Map<string, string>(); // attachmentId → data URL

// base64 data URL 常驻内存，长会话无上限会膨胀：Map 迭代序=插入序，超限逐出最旧
function cacheBytes(id: string, url: string): void {
  bytesCache.set(id, url);
  while (bytesCache.size > BYTES_CACHE_MAX) {
    const oldest = bytesCache.keys().next().value;
    if (oldest === undefined) break;
    bytesCache.delete(oldest);
  }
}

/** user/message 事件里的内容块（排队区手里只有队列快照的 content，没有事件本体）。 */
export function messageContentOf(event: unknown): ContentBlock[] {
  const content = (event as { data?: { content?: ContentBlock[] } } | undefined)?.data?.content;
  return Array.isArray(content) ? content : [];
}

function attachmentsOf(content: readonly ContentBlock[]): Att[] {
  return content
    .filter((b) => b.type === "image" && !!(b as { attachment?: Att }).attachment)
    .map((b) => (b as { attachment: Att }).attachment);
}

/** 0.1.5 通用文件块：{type:'file', attachment:{attachmentId,name,bytes}}。 */
function fileRefsOf(content: readonly ContentBlock[]): Array<{ attachmentId: string; name: string; bytes?: number }> {
  return content
    .filter((b) => b.type === "file" && !!(b as { attachment?: { attachmentId: string; name?: string; bytes?: number } }).attachment)
    .map((b) => {
      const a = (b as { attachment: { attachmentId: string; name?: string; bytes?: number } }).attachment;
      return { attachmentId: a.attachmentId, name: a.name ?? a.attachmentId.slice(0, 16), bytes: a.bytes };
    });
}

/** 用户消息的附件带：**一律胶囊**（与输入框里那颗同一个组件）。传的是**内容块**而不是
 *  事件本体：排队区手里只有队列快照里的 content，没有事件。 */
export function UserAttachments({ sessionId, content }: { sessionId: string; content: readonly ContentBlock[] }) {
  const [lightbox, setLightbox] = useState<{ src: string; name?: string; kind?: "video" } | null>(null);
  const atts = attachmentsOf(content);
  const files = fileRefsOf(content);
  if (atts.length === 0 && files.length === 0) return null;
  return (
    <div className="user-attachments">
      {atts.map((a) => (
        <ImageCapsule key={a.attachmentId} sessionId={sessionId} att={a} t={t}
          onOpen={(src, name) => setLightbox({ src, name })} />
      ))}
      {files.map((f) => {
        // 视频且本端有它的字节（刚上传过）→ 胶囊 + 首帧悬停画面；否则出
        // 图标 + 名字 + 大小——没有字节就不摆画面（宁可没有，也不摆一块空白）
        const videoUrl = resolveFileIconName(f.name) === "video" ? localMediaUrl(f.attachmentId) : undefined;
        return videoUrl ? (
          <AttachmentPill key={f.attachmentId} name={f.name} icon="file" t={t}
            preview={{ src: videoUrl, video: true }}
            onOpen={() => setLightbox({ src: videoUrl, name: f.name, kind: "video" })} />
        ) : (
          <AttachmentPill key={f.attachmentId} name={f.name} icon="file" t={t}
            meta={f.bytes !== undefined ? sizeText(f.bytes) : undefined} />
        );
      })}
      {lightbox && <Lightbox src={lightbox.src} alt={lightbox.name} kind={lightbox.kind} onClose={() => setLightbox(null)} />}
    </div>
  );
}

/** 用户消息里的图片胶囊：字节拉回来当悬停画面，点开进 Lightbox。 */
function ImageCapsule({ sessionId, att, t, onOpen }: {
  sessionId: string;
  att: Att;
  t: (zh: string) => string;
  onOpen: (src: string, name?: string) => void;
}) {
  const src = useAttachmentBytes(sessionId, att.attachmentId);
  return (
    <AttachmentPill
      name={att.name ?? att.attachmentId.slice(0, 16)}
      icon="image"
      t={t}
      preview={src ? { src, video: false } : null}
      onOpen={src ? () => onOpen(src, att.name) : undefined}
    />
  );
}

/** 附件字节（data URL）：先查缓存，未命中才拉。引擎不可达时留占位（返回 null）。 */
function useAttachmentBytes(sessionId: string, attachmentId: string): string | null {
  const [src, setSrc] = useState<string | null>(() => bytesCache.get(attachmentId) ?? null);
  useEffect(() => {
    if (src) return;
    let alive = true;
    void api.attachment({ sessionId, attachmentId }).then((r) => {
      const url = `data:${r.attachment.mediaType};base64,${r.data}`;
      cacheBytes(attachmentId, url);
      if (alive) setSrc(url);
    }).catch(() => void 0); // 引擎不可达：留占位
    return () => { alive = false; };
  }, [sessionId, attachmentId, src]);
  return src;
}

/** 自带 Lightbox 的附件缩略图（用户消息图片与工具结果图片共用）。 */
export function AttachmentThumb({ sessionId, att }: { sessionId: string; att: Att }) {
  const [lightbox, setLightbox] = useState<{ src: string; name?: string } | null>(null);
  return (
    <>
      <Thumb sessionId={sessionId} att={att} onOpen={(src, name) => setLightbox({ src, name })} />
      {lightbox && <Lightbox src={lightbox.src} alt={lightbox.name} onClose={() => setLightbox(null)} />}
    </>
  );
}

function Thumb({ sessionId, att, onOpen }: { sessionId: string; att: Att; onOpen: (src: string, name?: string) => void }) {
  const src = useAttachmentBytes(sessionId, att.attachmentId);
  return (
    <button
      type="button"
      className="user-attachment-thumb"
      onClick={() => src && onOpen(src, att.name)}
      data-tip={att.name ?? att.attachmentId.slice(0, 16)}
    >
      {src ? <img src={src} alt={att.name ?? ""} /> : <span className="user-attachment-loading" aria-hidden="true" />}
    </button>
  );
}
