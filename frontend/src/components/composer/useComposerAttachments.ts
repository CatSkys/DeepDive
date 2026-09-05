// 附件摄入 hook：＋ 选择器 / 窗口级拖拽 / 剪贴板粘贴三条入口——图片收
// 字节 chip（每枚带摄入时生成的稳定 id），其余文件转 @ 引用（引擎宿主侧
// 读盘）。只管摄入与 chip 集合；chip 预览（Lightbox）与发送时拼
// PromptContentPart 由编排方做。

import { useEffect, useRef, useState } from "react";
import { pickAttachments, type PickedAttachment } from "../../host";
import { formatMention } from "../../atGrammar";
import { tt } from "../../i18n";

export interface Attachment {
  /** chip 的稳定 key，摄入时生成；不进发送载荷。 */
  id: string;
  data: string; // base64 (no prefix)
  mediaType: string;
  name: string;
}

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

/** drop 载荷摄入：同步收图片 chip，异步解析 file-url 转 @ 引用；纯浏览器
 *  环境拿不到路径的文件明示不可为。 */
function ingestDropped(
  dt: DataTransfer,
  addImageFile: (file: File) => void,
  setText: React.Dispatch<React.SetStateAction<string>>,
): void {
  let nonImage = 0;
  let urlless = 0;
  for (const f of Array.from(dt.files)) {
    if (f.type.startsWith("image/")) addImageFile(f);
    else nonImage += 1;
  }
  void fileUrlsOf(dt).then((urls) => {
    const mentions = urls.map((p) => mentionOf(p, p.endsWith("/") || !p.split("/").pop()?.includes("."))).filter((m): m is string => m !== undefined);
    if (mentions.length > 0) appendMentionsTo(setText, mentions);
    // WebKit 面非图片文件必带 public.file-url；缺 = 纯浏览器环境
    urlless = nonImage - mentions.length;
    if (urlless > 0) {
      // 文案在事件发生时读模块级 tt（最新 currentLang）：挂载闭包里的 useT
      // tt 是 lang 绑定闭包，挂载后切语言提示会滞留旧语言（AUD-089）。
      alert(tt("浏览器环境无法引用本地文件，请在桌面端使用", "Local file references need the desktop app"));
    }
  });
}

/** 壳选择器结果：图片→字节 chip，其余→@ 引用。 */
function ingestPicked(
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>,
  setText: React.Dispatch<React.SetStateAction<string>>,
  items: PickedAttachment[],
): void {
  const chips: Attachment[] = [];
  const mentions: string[] = [];
  for (const it of items) {
    const mime = IMAGE_MIME[it.name.split(".").pop()?.toLowerCase() ?? ""];
    if (it.isImage && it.base64 && mime) {
      chips.push({ id: crypto.randomUUID(), data: it.base64, mediaType: mime, name: it.name });
    } else {
      const m = mentionOf(it.path, it.isDir);
      if (m) mentions.push(m);
    }
  }
  if (chips.length > 0) setAttachments((prev) => [...prev, ...chips]);
  if (mentions.length > 0) appendMentionsTo(setText, mentions);
}

export function useComposerAttachments({ setText, hasShell }: {
  setText: React.Dispatch<React.SetStateAction<string>>;
  hasShell: boolean;
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const addImageFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataURL = String(reader.result);
      const comma = dataURL.indexOf(",");
      const mediaType = dataURL.slice(5, dataURL.indexOf(";"));
      setAttachments((prev) => [...prev, { id: crypto.randomUUID(), data: dataURL.slice(comma + 1), mediaType, name: file.name }]);
    };
    reader.readAsDataURL(file);
  };

  /** ＋＝上传附件：壳内 NSOpenPanel（文件+文件夹多选）；纯浏览器降级为
   *  图片选择 input（无路径可引用，非图片明示不可为）。 */
  const addAttachments = () => {
    if (hasShell) {
      void pickAttachments().then((items) => { if (items) ingestPicked(setAttachments, setText, items); });
    } else {
      fileRef.current?.click();
    }
  };

  const dragOver = useWindowFileDrag({ setText, addImageFile });

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) addImageFile(file);
    e.target.value = "";
  };

  return { attachments, setAttachments, addAttachments, addImageFile, dragOver, fileRef, onFile };
}

/** 拖拽：窗口级监听——会话界面任意处拖入文件都出虚线框提示；图片收字节
 *  chip，其余经 WebKit public.file-url 拿路径转 @ 引用（纯浏览器拿不到
 *  路径，明示不可为）。depth 计数对抗子元素边界的 enter/leave 抖动。 */
function useWindowFileDrag({ setText, addImageFile }: {
  setText: React.Dispatch<React.SetStateAction<string>>;
  addImageFile: (file: File) => void;
}) {
  // 拖拽附件：窗口级监听（会话界面任意处），非 composer 局部
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 摄入函数按当前渲染闭包工作，与听写订阅同款
  useEffect(() => attachWindowFileDrag({ setText, addImageFile, dragDepth, setDragOver }), []);
  return dragOver;
}

/** 挂窗口级拖拽监听，返回卸载函数。 */
function attachWindowFileDrag({
  setText,
  addImageFile,
  dragDepth,
  setDragOver,
}: {
  setText: React.Dispatch<React.SetStateAction<string>>;
  addImageFile: (file: File) => void;
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
    ingestDropped(dt, addImageFile, setText);
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
