// 附件摄入 hook：＋ 选择器 / 窗口级拖拽 / 剪贴板粘贴三条入口。0.1.5 面：
// 图片收字节 chip（随 prompt 直传），通用文件收上传 chip（fileUploads/upload
// 回执，就绪才可发送），文件夹转 @ 引用（引擎宿主侧读盘）。只管摄入与
// chip 集合；chip 预览与发送时拼 PromptContentPart 由编排方做。
// 摄入被拒（超限/读不到字节）必须当场说出来——用户定稿"附件不许静默丢"。

import { useCallback, useEffect, useRef, useState } from "react";
import { pickAttachments, type PickedAttachment } from "../../host";
import { formatMention } from "../../atGrammar";
import { tt } from "../../i18n";
import { api } from "../../api";
import { rememberUploadedMedia } from "../../session/localMedia";
import { uuid } from "../../uuid";
import { DD_EVENTS, onAppEvent } from "../../events";
import { alertDialog } from "../DialogHost";

/** 单文件上限＝桥的单请求上限（MiniHTTPServer.maxBodyBytes，超出即 413）：
 *  客户端先拦一次，别让用户等一个注定失败的上传。 */
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/** 超过上传上限的文件说明（图片与通用文件同一口径）。 */
function tooLargeNote(name: string): string {
  return tt(`「${name}」超过 32 MB 上传上限`, `"${name}" exceeds the 32 MB upload limit`);
}

/** 上传失败的原话：引擎/桥的错误文本优先（413 明确说成"超过 32 MB"），
 *  没有就回落通用一句——chip 的 tooltip 与发送失败的弹窗都读它。 */
export function uploadErrorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  if (/\b413\b/.test(msg)) return tt("超过 32 MB 上传上限", "Exceeds the 32 MB upload limit");
  return msg || tt("上传失败", "Upload failed");
}

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

/** 一个拖入项：是文件就带 File 字节，是文件夹就带它的路径（转 @ 引用）。 */
interface DroppedEntry {
  file?: File;
  /** 文件夹的绝对路径（WebKit 的 public.file-url 才给；纯浏览器往往拿不到）。 */
  dirPath?: string;
}

/** 拖拽载荷逐项分类。判断"是不是文件夹"只认文件系统条目（webkitGetAsEntry）—
 *  旧实现按"路径里有没有点"猜，把 Makefile/Dockerfile 当文件夹（多发一条无效
 *  @ 引用）、把 v1.2 这种带点的目录整个丢掉（什么都不发生）。 */
function classifyDrop(dt: DataTransfer): Promise<DroppedEntry[]> {
  const items = Array.from(dt.items).filter((i) => i.kind === "file");
  if (items.length === 0) {
    // 无 items（旧环境）：dt.files 一律按文件收，不做目录猜测。
    return Promise.resolve(Array.from(dt.files).map((file) => ({ file })));
  }
  const pending: Promise<DroppedEntry>[] = items.map((item) => {
    const entry = item.webkitGetAsEntry?.() ?? null;
    if (entry?.isDirectory !== true) return Promise.resolve({ file: item.getAsFile() ?? undefined });
    return new Promise<DroppedEntry>((resolve) => {
      item.getAsString((s) => resolve({
        dirPath: s?.startsWith("file://") ? decodeURIComponent(s.replace(/^file:\/\//, "")) : undefined,
      }));
    });
  });
  return Promise.all(pending);
}

/** drop 载荷摄入（0.1.5）：图片收字节 chip；通用文件走上传 chip；文件夹转
 *  @ 引用（引擎宿主侧读盘）。文件夹拿不到路径（纯浏览器）时明说，不静默。 */
function ingestDropped(
  dt: DataTransfer,
  addImageFile: (file: File) => void,
  addFileFile: (file: File) => void,
  setText: React.Dispatch<React.SetStateAction<string>>,
): void {
  void classifyDrop(dt).then((entries) => {
    let dirs = 0;
    const mentions: string[] = [];
    for (const entry of entries) {
      if (entry.dirPath !== undefined) {
        dirs += 1;
        const m = mentionOf(entry.dirPath, true);
        if (m) mentions.push(m);
      } else if (entry.file) {
        if (entry.file.type.startsWith("image/")) addImageFile(entry.file);
        else addFileFile(entry.file);
      }
    }
    if (mentions.length > 0) appendMentionsTo(setText, mentions);
    if (dirs > mentions.length) {
      void alertDialog({ message: tt("拖入的文件夹拿不到路径，无法引用（请在桌面应用里拖）", "Dropped folders expose no path here; drag them in the desktop app instead") });
    }
  });
}


/** 壳选择器结果：图片→字节 chip，文件→上传 chip，文件夹→@ 引用。
 *  壳因超限/读取失败没带字节的，明说改走了 @ 引用（引擎自己读盘），
 *  别让用户以为附件已随消息上传。 */
function ingestPicked(
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>,
  addFile: (file: File) => void,
  setText: React.Dispatch<React.SetStateAction<string>>,
  items: PickedAttachment[],
): void {
  const mentions: string[] = [];
  const skipped: string[] = [];
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
      if (!it.isDir) skipped.push(tooLargeNote(it.name));
    }
  }
  if (mentions.length > 0) appendMentionsTo(setText, mentions);
  if (skipped.length > 0) {
    void alertDialog({
      message: tt(
        `${skipped.join("；")}，已改为 @ 引用（由引擎自行读取，不随消息上传）`,
        `${skipped.join("; ")} — added as an @ reference instead (read by the engine, not uploaded with the message)`,
      ),
    });
  }
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
    if (file.size > MAX_UPLOAD_BYTES) {
      void alertDialog({ message: tooLargeNote(file.name) });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataURL = String(reader.result);
      const comma = dataURL.indexOf(",");
      const mediaType = dataURL.slice(5, dataURL.indexOf(";"));
      setAttachments((prev) => [...prev, { id: uuid(), kind: "image", data: dataURL.slice(comma + 1), mediaType, name: file.name }]);
    };
    reader.readAsDataURL(file);
  };

  const addFileFile = (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      void alertDialog({ message: tooLargeNote(file.name) });
      return;
    }
    addFile(file);
  };

  /** 一份字节的一次上传：progress 上报、中止器登记、chip 终态（成功留字节、
   *  失败留原因），返回回执；失败/取消回 null。摄入即传（addFile）与发送前
   *  补传/重传（uploadNow）共用这一份，别再写第二遍。 */
  const uploadOne = useCallback((id: string, sid: string, file: File): Promise<string | null> => {
    const ctl = new AbortController();
    cancels.current.set(id, () => ctl.abort());
    return api.uploadFileStreaming({
      sessionId: sid, file, name: file.name, signal: ctl.signal,
      onProgress: (loaded, total) => setAttachments((prev) => prev.map((a): Attachment =>
        a.id === id && a.kind === "file" ? { ...a, progress: total > 0 ? Math.round((loaded / total) * 100) : 0 } : a)),
    }).then(
      (r) => {
        cancels.current.delete(id);
        // 视频留一份本地 blob URL：文件部件的字节引擎拿不回来，缩略图靠它（见 session/localMedia）
        // 判名用回执里的 name（引擎净化过的），与排队/消息里渲染时的那个名字同源
        rememberUploadedMedia(r.file.attachmentId, r.file.name, file);
        setAttachments((prev) => prev.map((a): Attachment =>
          a.id === id && a.kind === "file"
            // file 字节留着不清：引擎侧回执失效（FILE_NOT_STAGED）时要重传同一份字节
            // ——用户定稿附件必须发出去（见 uploadNow 的 force）
            ? { ...a, status: "ready", receiptId: r.receiptId, bytes: r.file.bytes, error: undefined }
            : a));
        return r.receiptId;
      },
      (err: unknown) => {
        cancels.current.delete(id);
        const aborted = err instanceof DOMException && err.name === "AbortError";
        setAttachments((prev) => prev.map((a): Attachment =>
          a.id === id && a.kind === "file"
            ? { ...a, status: "error", error: aborted ? tt("已取消", "Cancelled") : uploadErrorText(err) }
            : a));
        return null;
      },
    );
  }, []);

  const addFile = useCallback((file: File) => {
    const id = uuid();
    if (sessionId) {
      setAttachments((prev) => [...prev, { id, kind: "file", name: file.name, status: "uploading", file, progress: 0 }]);
      void uploadOne(id, sessionId, file);
    } else {
      setAttachments((prev) => [...prev, { id, kind: "file", name: file.name, status: "pending", file }]);
    }
  }, [sessionId, uploadOne]);

  /** 取消一次进行中的上传（chip 上的 ×；已取消/失败可重试）。 */
  const cancelUpload = (id: string) => {
    cancels.current.get(id)?.();
  };

  /** 失败重试 / 草稿页 pending 在会话就绪后补传（编排方发送前调用）。
   *  返回本次传就绪的 receiptId 列表——setAttachments 不影响调用方当轮
   *  闭包里的 content，prompt 载荷必须据此补 {type:'file'} 部件；
   *  任一文件失败/取消返回 null（chip 停在 error 供重试）。
   *  force：连已就绪的也重传一遍（引擎回 FILE_NOT_STAGED = 旧回执在引擎侧已不可用，
   *  用户定稿附件必须发出去，所以拿到新回执再重发一次；字节一直留到发送，别清）。 */
  const uploadNow = async (sid: string, force = false): Promise<string[] | null> => {
    const pendingFiles = attachments.filter((a): a is FileAttachment =>
      a.kind === "file" && (force || a.status !== "ready"));
    const receipts: string[] = [];
    for (const f of pendingFiles) {
      if (!f.file) return null;
      setAttachments((prev) => prev.map((a): Attachment => a.id === f.id && a.kind === "file" ? { ...a, status: "uploading", progress: 0 } : a));
      const receiptId = await uploadOne(f.id, sid, f.file);
      if (receiptId === null) return null;
      receipts.push(receiptId);
    }
    return receipts;
  };

  /** 失败 chip 的失败原因（编排方在发送失败时把原话带给用户）。 */
  const firstUploadError = (): string | null =>
    attachments.find((a): a is FileAttachment => a.kind === "file" && a.status === "error")?.error ?? null;

  /** 草稿页失败 chip 重试：回 pending（无会话可传，发送建会话时补传）。 */
  const requeueFile = (id: string) => setAttachments((prev) => prev.map((a): Attachment =>
    a.id === id && a.kind === "file" && a.status === "error" ? { ...a, status: "pending", error: undefined } : a));

  /** ＋＝上传附件：壳内 NSOpenPanel（文件+文件夹多选）；纯浏览器降级为
   *  文件选择 input（无路径可引用）。 */
  const addAttachments = useCallback(() => {
    if (hasShell) {
      void pickAttachments().then((items) => { if (items) ingestPicked(setAttachments, addFile, setText, items); });
    } else {
      fileRef.current?.click();
    }
  }, [hasShell, addFile, setText]);

  // 命令面板「添加附件」与 composer ＋ 按钮同一条链路
  useEffect(() => onAppEvent(DD_EVENTS.composerAttach, () => addAttachments()), [addAttachments]);

  const dragOver = useWindowFileDrag({ setText, addImageFile, addFileFile });

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type.startsWith("image/")) addImageFile(file);
    else addFileFile(file);
    e.target.value = "";
  };

  /** 图片按通用文件原件再传一份（返回文件回执）：引擎对「模型条目没声明图片能力」
   *  的会话会在准入处拒 inline 图片部件，编排方据此把同一份字节改走文件回执投递，
   *  内容不减、发送不被打断（用户定稿：附件与内容必须发出去，跟模型无关）。 */
  const stageImageAsFile = async (sid: string, a: ImageAttachment): Promise<string | null> => {
    const binary = atob(a.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    try {
      const r = await api.uploadFileStreaming({
        sessionId: sid,
        file: new Blob([bytes], { type: a.mediaType }),
        name: a.name || "image",
      });
      return r.receiptId;
    } catch {
      return null; // 上传失败：由编排方按失败处理（不静默吞）
    }
  };

  return { attachments, setAttachments, addAttachments, addImageFile, uploadNow, stageImageAsFile, requeueFile, cancelUpload, firstUploadError, dragOver, fileRef, onFile };
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
