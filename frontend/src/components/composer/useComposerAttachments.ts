// 附件摄入 hook：三条入口——＋ 选择器、窗口级拖拽、壳按路径推回来的拖入项
// （`hostDroppedItems`：目录，以及悬浮面板那一投整批）。只管摄入与 chip 集合；
// chip 预览与发送时拼 PromptContentPart 由编排方做。
//
// 口径（用户心智：一律 chip）：
//   · **图片** → 字节 chip（随 prompt 直传，模型才看得见图；超过内联上限就按普通文件办）
//   · **普通文件** → 上传 chip（图标+名+进度，就绪才可发送）。**没有大小上限**：
//     页面拿不到字节的那种（选择器挑的大文件）由壳按路径流式上传，页面有的走 XHR
//     ——桥超过缓冲上限会落盘再转发，两条路都不吃内存（见 host.uploadAttachmentPath）。
//   · **文件夹** → @ 引用（没有字节可传，只能给路径，引擎宿主读盘）
// 摄入被拒（图太大、拿不到路径）必须当场说出来——用户定稿"附件不许静默丢"。

import { useCallback, useEffect, useRef, useState } from "react";
import { onHostEvent, pickAttachments, uploadAttachmentPath, type PickedAttachment } from "../../host";
import { formatMention } from "../../atGrammar";
import { tt } from "../../i18n";
import { api } from "../../api";
import { rememberUploadedMedia } from "../../session/localMedia";
import { uuid } from "../../uuid";
import { DD_EVENTS, onAppEvent } from "../../events";
import { alertDialog } from "../DialogHost";

/** **图片随消息内联**的字节上限＝桥的单请求缓冲上限（MiniHTTPServer.maxBodyBytes）。
 *  超了不弹错、也不拦：按普通文件走上传 chip（壳侧流式，无上限），附件照样发得出去。 */
const MAX_INLINE_IMAGE_BYTES = 32 * 1024 * 1024;

/** 图片大到没法内联时的说明（它会作为文件附件发出去，不是被丢掉）。 */
function tooLargeNote(name: string): string {
  return tt(`「${name}」超过 32 MB，按文件附件发送`, `"${name}" exceeds 32 MB and will be sent as a file attachment`);
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

/** 一份内联图的字节与类型（`ImageAttachment` 里真正进载荷的那三样）：截图直发那条路
 *  不建 chip，没有 id 可言。 */
export interface ShotImage {
  name: string;
  mediaType: string;
  data: string;
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
  /** 字节来源二选一：页面手里的 `File`（拖入/粘贴）或壳侧的 `path`（选择器挑的
   *  大文件，请壳按路径流式上传）。error/cancelled 态保留它供重试。 */
  file?: File;
  path?: string;
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

/** 引用串追加到草稿末尾（接在正文后面，前置空白由编辑器的 appendText 补）。
 *  走 appendToDraft 而不是整篇 setText：整篇替换会把正文里的附件原子一起抹掉。 */
type AppendToDraft = (suffix: string) => void;

function appendMentionsTo(appendToDraft: AppendToDraft, mentions: string[]) {
  appendToDraft(`${mentions.join(" ")} `);
}

function isFileDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

// 拖拽载荷分类：**不碰 `getAsString`**——WebKit 对文件项根本不回调它（实测：整个
// 拖放只暴露 `["Files"]`），拿它求文件夹路径会让整批挂在 Promise.all 上、一个都不
// 摄入，用户看到的就是"文件夹拖入不显示"（PITFALLS §4.36）。文件夹路径只有壳拿得到
// （拖放板），所以这里只同步挑出"有没有文件夹"，路径由壳另推（hostDroppedItems）。
export function classifyDrop(dt: DataTransfer): { files: File[]; dirs: number } {
  const items = Array.from(dt.items ?? []).filter((i) => i.kind === "file");
  if (items.length === 0) {
    // 无 items（旧环境）：dt.files 里只有文件（文件夹不出现在这里），直接收
    return { files: Array.from(dt.files ?? []), dirs: 0 };
  }
  const files: File[] = [];
  let dirs = 0;
  for (const item of items) {
    if (item.webkitGetAsEntry?.()?.isDirectory === true) {
      dirs += 1;
      continue;
    }
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return { files, dirs };
}

/** drop 摄入：图片收字节 chip；其余文件走上传 chip；文件夹由壳推路径转 @ 引用。
 *  分类是同步的，所以"同一投里有文件夹"不会连坐里面的文件——它们照收。 */
function ingestDropped(
  dt: DataTransfer,
  addImageFile: (file: File) => void,
  addFileFile: (file: File) => void,
  hasShell: boolean,
): void {
  const { files, dirs } = classifyDrop(dt);
  for (const file of files) {
    if (file.type.startsWith("image/")) addImageFile(file);
    else addFileFile(file);
  }
  // 壳在时文件夹路径由壳推；纯浏览器没有路径可引用，明说，不静默。
  if (dirs > 0 && !hasShell) {
    void alertDialog({
      message: tt("拖入的文件夹拿不到路径，无法引用（请在桌面应用里拖入）",
        "Dropped folders expose no path here; drag them in the desktop app instead"),
    });
  }
}


/** 一个壳侧 pick 项怎么投递：**能内联的图**（模型才看得见）、**要传成回执的文件**、
 *  **文件夹**（没有字节可传，只能给路径）。＋ 选择器的摄入与截图直发那条消息共用这一份
 *  判据——认不出的扩展名按文件办，与 `ingestPicked` 同款（别在两处各判一遍）。 */
export type PickedDelivery =
  | { kind: "image"; mime: string; base64: string }
  | { kind: "file" }
  | { kind: "folder" };

export function pickedDelivery(item: PickedAttachment): PickedDelivery {
  const mime = IMAGE_MIME[item.name.split(".").pop()?.toLowerCase() ?? ""];
  if (item.isImage && item.base64 && mime) return { kind: "image", mime, base64: item.base64 };
  return item.isDir ? { kind: "folder" } : { kind: "file" };
}

/** 壳选择器结果：图片→字节 chip（要内联给模型看）；其余文件→上传 chip（拿不到字节
 *  的那批由壳按路径流式上传，**没有大小上限**）；文件夹→@ 引用（没有字节可传）。 */
export function ingestPicked(
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>,
  addFilePath: (path: string, name: string, bytes?: number) => void,
  appendToDraft: AppendToDraft,
  onAdded: (attachment: Attachment) => void,
  items: PickedAttachment[],
): void {
  const mentions: string[] = [];
  for (const it of items) {
    const delivery = pickedDelivery(it);
    if (delivery.kind === "image") {
      const att: Attachment = { id: uuid(), kind: "image", data: delivery.base64, mediaType: delivery.mime, name: it.name };
      setAttachments((prev) => [...prev, att]);
      onAdded(att);
    } else if (delivery.kind === "file") {
      addFilePath(it.path, it.name, it.bytes);
    } else {
      const m = mentionOf(it.path, true);
      if (m) mentions.push(m);
    }
  }
  if (mentions.length > 0) appendMentionsTo(appendToDraft, mentions);
}

export function useComposerAttachments({ appendToDraft, onAdded, hasShell, sessionId }: {
  /** 往草稿末尾追加一段（文件夹转 `@` 引用时用）。 */
  appendToDraft: AppendToDraft;
  /** 刚摄入一颗附件（图片/文件）：编排方据此在正文里插一枚行内令牌。 */
  onAdded: (attachment: Attachment) => void;
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
    if (file.size > MAX_INLINE_IMAGE_BYTES) {
      void alertDialog({ message: tooLargeNote(file.name) });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataURL = String(reader.result);
      const comma = dataURL.indexOf(",");
      const mediaType = dataURL.slice(5, dataURL.indexOf(";"));
      const att: Attachment = { id: uuid(), kind: "image", data: dataURL.slice(comma + 1), mediaType, name: file.name };
      setAttachments((prev) => [...prev, att]);
      onAdded(att);
    };
    reader.readAsDataURL(file);
  };

  /** 拖入的普通文件：直接成上传 chip——**没有大小门槛**（页面有字节走 XHR；
   *  桥超过缓冲上限会落盘再转发，见 MiniHTTPServer）。 */
  const addFileFile = (file: File) => addFile(file);

  /** 一次上传：progress 上报、中止器登记、chip 终态（成功留字节、失败留原因），
   *  返回回执；失败/取消回 null。摄入即传（addFile/addFilePath）与发送前补传/重传
   *  （uploadNow）共用这一份，别再写第二遍。
   *  路径来源（壳侧流式）没有进度回调，也取消不了（文件已在壳那边读着了）——
   *  chip 停在"上传中"直到回执，用户删掉 chip 只是不再要那个回执。 */
  const uploadOne = useCallback((id: string, sid: string, source: { file: File } | { path: string; name: string }): Promise<string | null> => {
    if ("path" in source) {
      return uploadAttachmentPath(source.path, sid, source.name).then((r) => {
        if (r === null) {
          setAttachments((prev) => prev.map((a): Attachment =>
            a.id === id && a.kind === "file" ? { ...a, status: "error", error: tt("上传失败", "Upload failed") } : a));
          return null;
        }
        setAttachments((prev) => prev.map((a): Attachment =>
          a.id === id && a.kind === "file" ? { ...a, status: "ready", receiptId: r.receiptId, bytes: r.file.bytes, error: undefined } : a));
        return r.receiptId;
      });
    }
    const file = source.file;
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
    const att: FileAttachment = sessionId
      ? { id, kind: "file", name: file.name, status: "uploading", file, progress: 0 }
      : { id, kind: "file", name: file.name, status: "pending", file };
    setAttachments((prev) => [...prev, att]);
    onAdded(att);
    if (sessionId) void uploadOne(id, sessionId, { file });
  }, [sessionId, uploadOne, onAdded]);

  /** 路径来源的上传 chip（选择器挑的文件）：上传时请壳按路径流式送给引擎。
   *  草稿页没有会话可传 → pending，发送建会话时补传（与 addFile 同一套状态机）。 */
  const addFilePath = useCallback((path: string, name: string, bytes?: number) => {
    const id = uuid();
    const att: FileAttachment = sessionId
      ? { id, kind: "file", name, bytes, status: "uploading", path }
      : { id, kind: "file", name, bytes, status: "pending", path };
    setAttachments((prev) => [...prev, att]);
    onAdded(att);
    if (sessionId) void uploadOne(id, sessionId, { path, name });
  }, [sessionId, uploadOne, onAdded]);

  /** 取消一次进行中的上传（chip 上的 ×；已取消/失败可重试）。 */
  const cancelUpload = (id: string) => {
    cancels.current.get(id)?.();
  };

  /** 失败重试 / 草稿页 pending 在会话就绪后补传（编排方发送前调用）。
   *  返回本次传就绪的 **附件 id → receiptId**——setAttachments 不影响调用方当轮闭包里的
   *  载荷，发送前必须据此补 {type:'file'} 部件（按 id 认，不是按数组下标对位：附件在正文
   *  里的位置由文档决定）；任一文件失败/取消返回 null（chip 停在 error 供重试）。
   *  force：连已就绪的也重传一遍（引擎回 FILE_NOT_STAGED = 旧回执在引擎侧已不可用，
   *  用户定稿附件必须发出去，所以拿到新回执再重发一次；字节一直留到发送，别清）。 */
  const uploadNow = async (sid: string, force = false): Promise<Array<{ id: string; receiptId: string }> | null> => {
    const pendingFiles = attachments.filter((a): a is FileAttachment =>
      a.kind === "file" && (force || a.status !== "ready"));
    const receipts: Array<{ id: string; receiptId: string }> = [];
    for (const f of pendingFiles) {
      const source = f.file ? { file: f.file } : f.path ? { path: f.path, name: f.name } : null;
      if (source === null) return null;
      setAttachments((prev) => prev.map((a): Attachment => a.id === f.id && a.kind === "file" ? { ...a, status: "uploading", progress: 0 } : a));
      const receiptId = await uploadOne(f.id, sid, source);
      if (receiptId === null) return null;
      receipts.push({ id: f.id, receiptId });
    }
    return receipts;
  };

  /** 失败 chip 的失败原因（编排方在发送失败时把原话带给用户）。 */
  const firstUploadError = (): string | null =>
    attachments.find((a): a is FileAttachment => a.kind === "file" && a.status === "error")?.error ?? null;

  /** 草稿页失败 chip 重试：回 pending（无会话可传，发送建会话时补传）。 */
  const requeueFile = (id: string) => setAttachments((prev) => prev.map((a): Attachment =>
    a.id === id && a.kind === "file" && a.status === "error" ? { ...a, status: "pending", error: undefined } : a));

  /** ＋ 菜单的一行：壳内 NSOpenPanel（`kind` 决定文件还是文件夹）；纯浏览器
   *  降级为文件选择 input（无路径可引用，文件夹那项在浏览器里等同无操作）。 */
  const addAttachments = useCallback((kind: "files" | "folders" = "files") => {
    if (hasShell) {
      void pickAttachments(kind).then((items) => { if (items) ingestPicked(setAttachments, addFilePath, appendToDraft, onAdded, items); });
    } else if (kind === "files") {
      fileRef.current?.click();
    }
  }, [hasShell, addFilePath, appendToDraft, onAdded]);

  // 命令面板「添加附件」与 composer ＋ 按钮同一条链路
  useEffect(() => onAppEvent(DD_EVENTS.composerAttach, () => addAttachments()), [addAttachments]);

  const { dragOver, clearDragOver } = useWindowFileDrag({ addImageFile, addFileFile, hasShell });

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
  const stageImageAsFile = async (sid: string, image: ShotImage): Promise<string | null> => {
    const binary = atob(image.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    try {
      const r = await api.uploadFileStreaming({
        sessionId: sid,
        file: new Blob([bytes], { type: image.mediaType }),
        name: image.name || "image",
      });
      return r.receiptId;
    } catch {
      return null; // 上传失败：由编排方按失败处理（不静默吞）
    }
  };

  /** 把外部已备好的附件项（截图等）按 ＋ 选择器同一份逻辑摄入。 */
  const ingestAttachments = useCallback(
    (items: PickedAttachment[]) => ingestPicked(setAttachments, addFilePath, appendToDraft, onAdded, items),
    [addFilePath, appendToDraft, onAdded],
  );

  // 壳推来的**拖入的东西**（路径只有它拿得到），两条路都会到这儿：
  //   · 目录：DOM 侧 WebKit 认文件不认目录，那一投页面根本收不到，只有壳读得到路径；
  //   · 药丸/胶囊悬浮面板那一投整批：那一投被壳的原生落点卡接走（`MiniPanelDropView`），
  //     页面连 drop 事件都没有，文件与文件夹都只能由壳按路径推回来。
  // 摄入复用 ＋ 选择器那一份（`ingestPicked`）：图片内联 chip、文件上传 chip、文件夹转
  // @ 引用，各面上的行为因此一致。壳接手之后 DOM 的 drop 可能压根不来，蒙版必须在这
  // 条命令里自己收（否则它挂一整块挡着界面）。
  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd !== "hostDroppedItems") return;
    clearDragOver();
    ingestAttachments((payload as { items?: PickedAttachment[] } | undefined)?.items ?? []);
  }), [clearDragOver, ingestAttachments]);

  // 壳推来的**一投没落下来**（承诺的文件没到、位图读不成图…）：面板上当场说出来——
  // 附件不许静默丢（与"图太大/文件夹拿不到路径"同一条口径）。
  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd !== "hostDropFailed") return;
    const names = (payload as { names?: string[] } | undefined)?.names ?? [];
    void alertDialog({
      message: names.length > 0
        ? tt(`没能导入：${names.join("、")}`, `Could not import: ${names.join(", ")}`)
        : tt("拖入的东西没能导入", "The dropped items could not be imported"),
    });
  }), []);

  return { attachments, setAttachments, addAttachments, ingestAttachments, addImageFile, uploadNow, stageImageAsFile, requeueFile, cancelUpload, firstUploadError, dragOver, fileRef, onFile };
}

/** 拖拽：窗口级监听——会话界面任意处拖入文件都出虚线框提示。图片收字节 chip、
 *  文件走上传 chip、文件夹由壳推路径（见 classifyDrop）。depth 计数对抗子元素
 *  边界的 enter/leave 抖动。 */
function useWindowFileDrag({ addImageFile, addFileFile, hasShell }: {
  addImageFile: (file: File) => void;
  addFileFile: (file: File) => void;
  hasShell: boolean;
}) {
  // 拖拽附件：窗口级监听（会话界面任意处），非 composer 局部
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 摄入函数按当前渲染闭包工作，与听写订阅同款
  useEffect(() => attachWindowFileDrag({ addImageFile, addFileFile, hasShell, dragDepth, setDragOver }), []);
  /** 手动收掉蒙版：壳接手这一投时 DOM 的 drop 可能不来（见 hook 里那条命令）。 */
  const clearDragOver = useCallback(() => {
    dragDepth.current = 0;
    setDragOver(false);
  }, []);
  return { dragOver, clearDragOver };
}

/** 挂窗口级拖拽监听，返回卸载函数。 */
function attachWindowFileDrag({
  addImageFile,
  addFileFile,
  hasShell,
  dragDepth,
  setDragOver,
}: {
  addImageFile: (file: File) => void;
  addFileFile: (file: File) => void;
  hasShell: boolean;
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
    ingestDropped(dt, addImageFile, addFileFile, hasShell);
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
