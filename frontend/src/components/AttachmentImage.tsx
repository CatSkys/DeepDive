import { useEffect, useState } from "react";
import { api } from "../api";
import { Lightbox } from "./Lightbox";
import type { ContentBlock } from "../types";

// 用户消息图片（3.2 收尾）：attachment 引用块的缩略图渲染，点击 Lightbox
// 放大。字节经 session.attachment 拉取，attachmentId 全局缓存（历史回放
// 与实时帧可能重复出现同一附件）。

interface Att {
  attachmentId: string;
  mediaType: string;
  name?: string;
  width?: number;
  height?: number;
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

function attachmentsOf(event: unknown): Att[] {
  const content = (event as { data?: { content?: ContentBlock[] } } | undefined)?.data?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((b) => b.type === "image" && !!(b as { attachment?: Att }).attachment)
    .map((b) => (b as { attachment: Att }).attachment);
}

export function UserAttachments({ sessionId, event }: { sessionId: string; event: unknown }) {
  const [lightbox, setLightbox] = useState<{ src: string; name?: string } | null>(null);
  const atts = attachmentsOf(event);
  if (atts.length === 0) return null;
  return (
    <div className="user-attachments">
      {atts.map((a) => (
        <Thumb key={a.attachmentId} sessionId={sessionId} att={a} onOpen={(src, name) => setLightbox({ src, name })} />
      ))}
      {lightbox && <Lightbox src={lightbox.src} alt={lightbox.name} onClose={() => setLightbox(null)} />}
    </div>
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
