// 附件摄入 hook：＋ 选择器 / 窗口级拖拽 / 剪贴板粘贴三条入口。0.1.5 面：
// 图片收字节 chip（随 prompt 直传），通用文件收上传 chip（fileUploads/upload
// 回执，就绪才可发送），文件夹转 @ 引用（引擎宿主侧读盘）。只管摄入与
// chip 集合；chip 预览与发送时拼 PromptContentPart 由编排方做。

import { useEffect, useRef, useState } from "react";
import { pickAttachments, type PickedAttachment } from "../../host";
import { formatMention } from "../../atGrammar";
import { tt } from "../../i18n";
import { api } from "../../api";
import { uuid } from "../../uuid";

export interface ImageAttachment {
  /** chip 的稳定 key，摄入时生成；不进发送载荷。 */
  id: string;
  kind: "image";
  data: string; // base64 (no prefix)
  mediaType: string;
  name: string;
}

/** 通用文件 chip（0.1.5 流式路由）：摄入即上传（草稿页无会话则 pending 到
 *  发送时），带进度百分比与取消；回执就绪才能随 prompt 发送。 */
export interface FileAttachment {
  id: string;
  kind: "file";
  name: string;
  bytes?: number;
  /** pending=等会话（草稿页）；uploading/ready/error=已起上传。 */
  status: "pending" | "uploading" | "ready" | "error";
  receiptId?: string;
  /** uploading：0-100。 */
  progress?: number;
  /** error/cancelled 态保留 File 供重试。 */
  file?: File;
  error?: string;
}

export type Attachment = ImageAttachment | FileAttachment;

// rc.2 prompt 面只收图片字节附件（PromptContentPart = text|image，imageLimits
// 准入）；其余文件/文件夹没有上传通道，走 @ 引用（引擎宿主侧读盘，
// DSH-WIRE §5）——即原生的"传文件"方式，不造假上传入口。
const IMAGE_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};

/** 路径 → 自闭合的 @ 引用（目录带引号时 formatMention 保持开引用供续层，
 *  选择器/拖拽插入的是完整引用，补收引号）。 */
function mentionOf(path: string, isDir: boolean): string | undefined {
  const m = formatMention({ path, kind: isDir ? "directory" : "file" }, false);
  if (m === undefined) return undefined;
  return m.startsWith(`@"`) && !m.endsWith(`"`) ? `${m}"` : m;
}

/** 引用串追加到草稿末尾（已有内容且无尾随空白时先补一个空格）。 */
function appendMentionsTo(setText: React.Dispatch<React.SetStateAction<string>>, mentions: string[]) {
  setText((cur) => (cur && !/\s$/.test(cur) ? `${cur} ` : cur) + `${mentions.join(" ")} `);
}

function isFileDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

/** 拖拽载荷里的 WebKit public.file-url → 文件路径（getAsString 是回调制，包 Promise）。 */
function fileUrlsOf(dt: DataTransfer): Promise<string[]> {
  return new Promise((resolve) => {
    const items = Array.from(dt.items).filter((i) => i.kind === "file" && i.type === "public.file-url");
    const out: string[] = [];
    let pending = items.length;
    if (pending === 0) { resolve(out); return; }
    for (const item of items) {
      item.getAsString((s) => {
        if (s?.startsWith("file://")) out.push(decodeURIComponent(s.replace(/^file:\/\//, "")));
        pending -= 1;
        if (pending === 0) resolve(out);
      });
    }
  });
}

/** drop 载荷摄入（0.1.5）：图片收字节 chip；通用文件（dt.files 有字节）走
 *  上传 chip；file-url 里的文件夹转 @ 引用；纯浏览器环境拿不到路径的文件
 *  明示不可为。 */
function ingestDropped(
  dt: DataTransfer,
  addImageFile: (file: File) => void,
  addFileFile: (file: File) => void,
  setText: React.Dispatch<React.SetStateAction<string>>,
): void {
  for (const f of Array.from(dt.files)) {
    if (f.type.startsWith("image/")) addImageFile(f);
    else addFileFile(f);
  }
  void fileUrlsOf(dt).then((urls) => {
    // 文件夹（路径以 / 结尾或无扩展名目录形态）才转引用；文件已走真上传。
    // 纯浏览器环境拖文件夹无 file-url 也无字节——静默无操作（旧行为是弹
    // 窗提示，文件改真上传后该提示已无对应场景）。
    const mentions = urls
      .filter((p) => p.endsWith("/") || !p.split("/").pop()?.includes("."))
      .map((p) => mentionOf(p, true))
      .filter((m): m is string => m !== undefined);
    if (mentions.length > 0) appendMentionsTo(setText, mentions);
  });
}

/** 壳选择器结果：图片→字节 chip，文件→上传 chip，文件夹→@ 引用。 */
function ingestPicked(
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>,
  addFile: (file: File) => void,
  setText: React.Dispatch<React.SetStateAction<string>>,
  items: PickedAttachment[],
): void {
  const mentions: string[] = [];
  for (const it of items) {
    const mime = IMAGE_MIME[it.name.split(".").pop()?.toLowerCase() ?? ""];
    if (it.isImage && it.base64 && mime) {
      setAttachments((prev) => [...prev, { id: uuid(), kind: "image", data: it.base64!, mediaType: mime, name: it.name }]);
    } else if (!it.isDir && it.base64) {
      // 壳回传的是 base64：转 File 供流式上传（字节一致）
      const bin = atob(it.base64!);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      addFile(new File([bytes], it.name));
    } else {
      const m = mentionOf(it.path, it.isDir);
      if (m) mentions.push(m);
    }
  }
  if (mentions.length > 0) appendMentionsTo(setText, mentions);
}

export function useComposerAttachments({ setText, hasShell, sessionId }: {
  setText: React.Dispatch<React.SetStateAction<string>>;
  hasShell: boolean;
  /** 上传目标会话；草稿页（null）文件 chip 挂 pending，发送时建会话再传。 */
  sessionId: string | null;
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 进行中上传的中止器（chip × 触发）。 */
  const cancels = useRef(new Map<string, () => void>());

  const addImageFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataURL = String(reader.result);
      const comma = dataURL.indexOf(",");
      const mediaType = dataURL.slice(5, dataURL.indexOf(";"));
      setAttachments((prev) => [...prev, { id: uuid(), kind: "image", data: dataURL.slice(comma + 1), mediaType, name: file.name }]);
    };
    reader.readAsDataURL(file);
  };

  // 通用文件：读字节成 chip 并立即上传（无会话则 pending）。
  const addFileFile = (file: File) => addFile(file);

  const startUpload = (id: string, sid: string, file: File) => {
    const ctl = new AbortController();
    cancels.current.set(id, () => ctl.abort());
    void api.uploadFileStreaming({
      sessionId: sid, file, name: file.name, signal: ctl.signal,
      onProgress: (loaded, total) => setAttachments((prev) => prev.map((a): Attachment =>
        a.id === id && a.kind === "file" ? { ...a, progress: total > 0 ? Math.round((loaded / total) * 100) : 0 } : a)),
    }).then(
      (r) => {
        cancels.current.delete(id);
        setAttachments((prev) => prev.map((a): Attachment =>
          a.id === id && a.kind === "file"
            ? { ...a, status: "ready", receiptId: r.receiptId, bytes: r.file.bytes, file: undefined, error: undefined }
            : a));
      },
      (err: unknown) => {
        cancels.current.delete(id);
        const aborted = err instanceof DOMException && err.name === "AbortError";
        setAttachments((prev) => prev.map((a): Attachment =>
          a.id === id && a.kind === "file"
            ? aborted
              ? { ...a, status: "error", error: tt("已取消", "Cancelled") }
              : { ...a, status: "error", error: tt("上传失败", "Upload failed") }
            : a));
      },
    );
  };

  const addFile = (file: File) => {
    const id = uuid();
    if (sessionId) {
      setAttachments((prev) => [...prev, { id, kind: "file", name: file.name, status: "uploading", file, progress: 0 }]);
      startUpload(id, sessionId, file);
    } else {
      setAttachments((prev) => [...prev, { id, kind: "file", name: file.name, status: "pending", file }]);
    }
  };

  /** 取消一次进行中的上传（chip 上的 ×；已取消/失败可重试）。 */
  const cancelUpload = (id: string) => {
    cancels.current.get(id)?.();
  };

  /** 失败重试 / 草稿页 pending 在会话就绪后补传（编排方发送前调用）。 */
  const uploadNow = async (sid: string): Promise<boolean> => {
    const pendingFiles = attachments.filter((a): a is FileAttachment => a.kind === "file" && a.status !== "ready");
    for (const f of pendingFiles) {
      if (!f.file) return false;
      setAttachments((prev) => prev.map((a): Attachment => a.id === f.id && a.kind === "file" ? { ...a, status: "uploading", progress: 0 } : a));
      const ok = await new Promise<boolean>((resolve) => {
        const ctl = new AbortController();
        cancels.current.set(f.id, () => ctl.abort());
        void api.uploadFileStreaming({
          sessionId: sid, file: f.file!, name: f.name, signal: ctl.signal,
          onProgress: (loaded, total) => setAttachments((prev) => prev.map((a): Attachment =>
            a.id === f.id && a.kind === "file" ? { ...a, progress: total > 0 ? Math.round((loaded / total) * 100) : 0 } : a)),
        }).then(
          (r) => {
            cancels.current.delete(f.id);
            setAttachments((prev) => prev.map((a): Attachment =>
              a.id === f.id && a.kind === "file"
                ? { ...a, status: "ready", receiptId: r.receiptId, bytes: r.file.bytes, file: undefined }
                : a));
            resolve(true);
          },
          () => {
            cancels.current.delete(f.id);
            setAttachments((prev) => prev.map((a): Attachment =>
              a.id === f.id && a.kind === "file" ? { ...a, status: "error", error: tt("上传失败", "Upload failed") } : a));
            resolve(false);
          },
        );
      });
      if (!ok) return false;
    }
    return true;
  };

  /** ＋＝上传附件：壳内 NSOpenPanel（文件+文件夹多选）；纯浏览器降级为
   *  文件选择 input（无路径可引用）。 */
  const addAttachments = () => {
    if (hasShell) {
      void pickAttachments().then((items) => { if (items) ingestPicked(setAttachments, addFile, setText, items); });
    } else {
      fileRef.current?.click();
    }
  };

  const dragOver = useWindowFileDrag({ setText, addImageFile, addFileFile });

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type.startsWith("image/")) addImageFile(file);
    else addFileFile(file);
    e.target.value = "";
  };

  return { attachments, setAttachments, addAttachments, addImageFile, uploadNow, cancelUpload, dragOver, fileRef, onFile };
}

/** 拖拽：窗口级监听——会话界面任意处拖入文件都出虚线框提示；图片收字节
 *  chip，其余经 WebKit public.file-url 拿路径转 @ 引用（纯浏览器拿不到
 *  路径，明示不可为）。depth 计数对抗子元素边界的 enter/leave 抖动。 */
function useWindowFileDrag({ setText, addImageFile, addFileFile }: {
  setText: React.Dispatch<React.SetStateAction<string>>;
  addImageFile: (file: File) => void;
  addFileFile: (file: File) => void;
}) {
  // 拖拽附件：窗口级监听（会话界面任意处），非 composer 局部
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 摄入函数按当前渲染闭包工作，与听写订阅同款
  useEffect(() => attachWindowFileDrag({ setText, addImageFile, addFileFile, dragDepth, setDragOver }), []);
  return dragOver;
}

/** 挂窗口级拖拽监听，返回卸载函数。 */
function attachWindowFileDrag({
  setText,
  addImageFile,
  addFileFile,
  dragDepth,
  setDragOver,
}: {
  setText: React.Dispatch<React.SetStateAction<string>>;
  addImageFile: (file: File) => void;
  addFileFile: (file: File) => void;
  dragDepth: { current: number };
  setDragOver: React.Dispatch<React.SetStateAction<boolean>>;
}): () => void {
  const onDragEnter = (e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  };
  const onDragOver = (e: DragEvent) => {
    if (dragDepth.current > 0) e.preventDefault();
  };
  const onDragLeave = () => {
    if (dragDepth.current === 0) return;
    dragDepth.current -= 1;
    if (dragDepth.current === 0) setDragOver(false);
  };
  const onDrop = (e: DragEvent) => {
    dragDepth.current = 0;
    setDragOver(false);
    if (!isFileDrag(e)) return;
    e.preventDefault();
    const dt = e.dataTransfer;
    if (!dt) return;
    ingestDropped(dt, addImageFile, addFileFile, setText);
  };
  window.addEventListener("dragenter", onDragEnter);
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("dragleave", onDragLeave);
  window.addEventListener("drop", onDrop);
  return () => {
    window.removeEventListener("dragenter", onDragEnter);
    window.removeEventListener("dragover", onDragOver);
    window.removeEventListener("dragleave", onDragLeave);
    window.removeEventListener("drop", onDrop);
  };
}
