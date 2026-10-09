import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { api } from "../api";
import { Lightbox } from "./Lightbox";
import type { ContentBlock } from "../types";

// 用户消息附件（3.2 收尾 + 0.1.5 通用文件）：attachment 引用块的渲染——
// 图片出缩略图（点击 Lightbox 放大），通用文件出 chip（图标+名字+大小）。
// 字节经 session.attachment 拉取，attachmentId 全局缓存（历史回放与实时帧
// 可能重复出现同一附件）。

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

function sizeText(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

/** 用户消息的附件带：图片出缩略图（点击 Lightbox）、通用文件出图标+名字+大小。
 *  传的是**内容块**而不是事件本体：排队区手里只有队列快照里的 content，没有事件。 */
export function UserAttachments({ sessionId, content }: { sessionId: string; content: readonly ContentBlock[] }) {
  const [lightbox, setLightbox] = useState<{ src: string; name?: string } | null>(null);
  const atts = attachmentsOf(content);
  const files = fileRefsOf(content);
  if (atts.length === 0 && files.length === 0) return null;
  return (
    <div className="user-attachments">
      {atts.map((a) => (
        <Thumb key={a.attachmentId} sessionId={sessionId} att={a} onOpen={(src, name) => setLightbox({ src, name })} />
      ))}
      {files.map((f) => (
        <span key={f.attachmentId} className="user-file-chip" data-tip={f.name}>
          <FileText size={14} />
          <span className="user-file-name">{f.name}</span>
          {f.bytes !== undefined && <span className="user-file-size">{sizeText(f.bytes)}</span>}
        </span>
      ))}
      {lightbox && <Lightbox src={lightbox.src} alt={lightbox.name} onClose={() => setLightbox(null)} />}
    </div>
  );
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
  const [src, setSrc] = useState<string | null>(() => bytesCache.get(att.attachmentId) ?? null);
  useEffect(() => {
    if (src) return;
    let alive = true;
    void api.attachment({ sessionId, attachmentId: att.attachmentId }).then((r) => {
      const url = `data:${r.attachment.mediaType};base64,${r.data}`;
      cacheBytes(att.attachmentId, url);
      if (alive) setSrc(url);
    }).catch(() => void 0); // 引擎不可达：留占位
    return () => { alive = false; };
  }, [sessionId, att.attachmentId, src]);
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
