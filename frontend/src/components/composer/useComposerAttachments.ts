// 附件摄入 hook：＋ 选择器 / 拖入 / 浏览器兜底三条入口。
//
// 摄入规则（用户 2026-10-09 定稿，全线一条口径）：
//   · **图片**收字节 chip——随 prompt 直传，模型才看得见图；
//   · **其余一律转 @ 引用**——文件与文件夹一样。引用只是路径文本（DSH-WIRE §7：引擎
//     不代读、模型要用自己去 read），所以**没有大小上限、没有上传等待**，读不读、
//     要不要压缩由 agent 自己决定。以前非图片走 32MB 上传通道，一个 .mp4 就被挡在
//     门外——那正是用户报"为什么会有大小限制"。
// 摄入被拒（拿不到路径、图大到没法内联）必须当场说出来——用户定稿"附件不许静默丢"。
//
// **路径只能从壳里来**：拖放板上只有壳看得见 file:// URL（文件和文件夹都在），
// DOM 那侧 WebKit 只给 `["Files"]`（实测），`getAsString` 对文件项根本不回调。
// 判据（谁成 chip、谁成引用、说什么话）在 attachmentIngest.ts，这里只管接线。

import { useCallback, useEffect, useRef, useState } from "react";
import { onHostEvent, pickAttachments, sendToShell, type PickedAttachment } from "../../host";
import { tt } from "../../i18n";
import { api } from "../../api";
import { uuid } from "../../uuid";
import { DD_EVENTS, onAppEvent } from "../../events";
import { alertDialog } from "../DialogHost";
import { MAX_INLINE_IMAGE_BYTES, noPathNote, planIngest, tooLargeImageNote } from "./attachmentIngest";

export interface ImageAttachment {
  /** chip 的稳定 key，不进发送载荷。 */
  id: string;
  kind: "image";
  data: string; // base64 (no prefix)
  mediaType: string;
  name: string;
}

/** 计划落在界面上：图片进 chip、引用进草稿（追加，已有内容且无尾随空白先补一个空格）、
 *  说明进弹窗。 */
function applyPlan(
  setAttachments: React.Dispatch<React.SetStateAction<ImageAttachment[]>>,
  setText: React.Dispatch<React.SetStateAction<string>>,
  items: PickedAttachment[],
): void {
  const plan = planIngest(items);
  for (const img of plan.images) setAttachments((prev) => [...prev, { id: uuid(), kind: "image", ...img }]);
  if (plan.mentions.length > 0) {
    setText((cur) => (cur && !/\s$/.test(cur) ? `${cur} ` : cur) + `${plan.mentions.join(" ")} `);
  }
  if (plan.notes.length > 0) void alertDialog({ message: plan.notes.join("；") });
}

export function useComposerAttachments({ setText, hasShell }: {
  setText: React.Dispatch<React.SetStateAction<string>>;
  hasShell: boolean;
}) {
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const addImageFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (file.size > MAX_INLINE_IMAGE_BYTES) {
      void alertDialog({ message: tooLargeImageNote(file.name) });
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

  /** 图片按通用文件原件再传一份（返回文件回执）：引擎对「模型条目没声明图片能力」
   *  的会话会在准入处拒 inline 图片部件，编排方据此把同一份字节改走文件回执投递，
   *  内容不减、发送不被打断（用户定稿：附件与内容必须发出去，跟模型无关）。
   *  这是唯一还会上传字节的地方——非图片一律走 @ 引用，不再有上传。 */
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

  /** ＋＝添加附件：壳内 NSOpenPanel（文件+文件夹多选，真路径）；纯浏览器降级为
   *  文件选择 input（没有路径可引用，只收图片）。 */
  const addAttachments = useCallback(() => {
    if (hasShell) {
      void pickAttachments().then((items) => { if (items) applyPlan(setAttachments, setText, items); });
    } else {
      fileRef.current?.click();
    }
  }, [hasShell, setText]);

  // 命令面板「添加附件」与 composer ＋ 按钮同一条链路
  useEffect(() => onAppEvent(DD_EVENTS.composerAttach, () => addAttachments()), [addAttachments]);

  // 拖拽武装：只有 composer 的窗口级拖拽提示亮着时，壳才接手原生拖入
  //（设置页上拖文件不该悄悄塞进草稿）
  const setArmed = useCallback((armed: boolean) => {
    if (hasShell) sendToShell({ type: "file-drop-armed", armed });
  }, [hasShell]);

  const { dragOver, resetDrag } = useWindowFileDrag({ addImageFile, hasShell, setArmed });

  // 拖入由壳读拖放板后推进来（网页侧看不到路径）：与 ＋ 同一条摄入路。
  // 提示也在这里收：这一投由壳接手，DOM 的 drop/dragleave 不一定会来，不收提示会一直
  // 挂着那条虚线框（收不到 dragleave 就没别的机会复位）。
  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd !== "hostFilesDropped") return;
    resetDrag();
    const items = (payload as { items?: PickedAttachment[] } | undefined)?.items;
    if (items) applyPlan(setAttachments, setText, items);
  }), [setText, resetDrag]);

  /** 纯浏览器的文件选择（没有壳就没有路径可引用，只收图片）。 */
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type.startsWith("image/")) addImageFile(file);
    else void alertDialog({ message: noPathNote(file.name) });
    e.target.value = "";
  };

  return { attachments, setAttachments, addAttachments, addImageFile, stageImageAsFile, dragOver, fileRef, onFile };
}

/** 拖拽：窗口级监听——会话界面任意处拖入文件都出虚线框提示。
 *  壳在时，落点由**壳**接手（只有它拿得到路径，见文件头），这里只管提示的显隐与"武装"；
 *  纯浏览器没有壳，退回 DOM 摄入：同步能判的都收下（图片），拿不到路径的明说，绝不静默。 */
function useWindowFileDrag({ addImageFile, hasShell, setArmed }: {
  addImageFile: (file: File) => void;
  hasShell: boolean;
  setArmed: (armed: boolean) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  /** 复位提示与深度计数（壳接手那一投之后调一次：DOM 事件可能不来）。 */
  const resetDrag = useCallback(() => {
    dragDepth.current = 0;
    setDragOver(false);
    setArmed(false);
  }, [setArmed]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 摄入函数按当前渲染闭包工作，与听写订阅同款
  useEffect(() => attachWindowFileDrag({ addImageFile, hasShell, setArmed, dragDepth, setDragOver }), []);
  return { dragOver, resetDrag };
}

function isFileDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

/** 纯浏览器的兜底摄入：只认同步拿得到的东西。**不要碰 getAsString**——WebKit 对
 *  文件项根本不回调它（实测：整个拖放只暴露 `["Files"]`，没有 text/uri-list 也没有
 *  public.file-url），拿它求路径会让整批挂在 Promise.all 上，一个都不摄入。 */
export function ingestBrowserDrop(dt: DataTransfer, addImageFile: (file: File) => void): void {
  const items = Array.from(dt.items ?? []).filter((i) => i.kind === "file");
  let dirs = 0;
  const dropped: File[] = [];
  for (const item of items) {
    if (item.webkitGetAsEntry?.()?.isDirectory === true) {
      dirs += 1;
      continue;
    }
    const file = item.getAsFile();
    if (file) dropped.push(file);
  }
  // 旧环境没有 items：dt.files 里只有文件（文件夹不出现在这里），直接收
  if (items.length === 0) dropped.push(...Array.from(dt.files ?? []));
  const refused: string[] = [];
  for (const file of dropped) {
    if (file.type.startsWith("image/")) addImageFile(file);
    else refused.push(noPathNote(file.name));
  }
  if (dirs > 0) {
    refused.push(tt("拖入的文件夹没有路径可引用（请在桌面应用里拖入）",
      "Dropped folders expose no path here, so they cannot be referenced (drag them in the desktop app)"));
  }
  if (refused.length > 0) void alertDialog({ message: refused.join("；") });
}

/** 挂窗口级拖拽监听，返回卸载函数。 */
function attachWindowFileDrag({
  addImageFile, hasShell, setArmed, dragDepth, setDragOver,
}: {
  addImageFile: (file: File) => void;
  hasShell: boolean;
  setArmed: (armed: boolean) => void;
  dragDepth: { current: number };
  setDragOver: React.Dispatch<React.SetStateAction<boolean>>;
}): () => void {
  const onDragEnter = (e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
    setArmed(true);
  };
  const onDragOver = (e: DragEvent) => {
    if (dragDepth.current > 0) e.preventDefault();
  };
  const onDragLeave = () => {
    if (dragDepth.current === 0) return;
    dragDepth.current -= 1;
    if (dragDepth.current === 0) {
      setDragOver(false);
      setArmed(false);
    }
  };
  const onDrop = (e: DragEvent) => {
    dragDepth.current = 0;
    setDragOver(false);
    setArmed(false);
    if (!isFileDrag(e)) return;
    e.preventDefault();
    // 壳在时这一投已经由壳接手（hostFilesDropped 会带着条目回来），这里只收提示：
    // 再摄入一遍就是双份。
    if (hasShell) return;
    if (e.dataTransfer) ingestBrowserDrop(e.dataTransfer, addImageFile);
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
