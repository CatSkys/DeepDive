// 附件原子在编辑器里的呈现：把每枚令牌换成一个**行内原子**（替换装饰 + 原子范围）——
// 光标跨过它、退格整颗删掉、点它/悬停它照旧（复用 AttachmentPill）。
// 附件对象与动作不在编辑器状态里（状态只放令牌与附件 id），由 atomStore 供给——见那里的
// 注释：widget 是独立 React 根，得订阅才能跟着上传进度一起重画。
import { createElement, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RangeSetBuilder, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { AttachmentPill } from "../../AttachmentPill";
import { resolveFileIconName } from "../../../session/fileIcons";
import { fileMeta } from "../fileMeta";
import { atomHost, atomsVersion, subscribeAtoms } from "./atomStore";
import { addTokens, tokenTable, tokensIn } from "./attachmentTokens";
import type { Attachment } from "../useComposerAttachments";

/** 一颗附件胶囊的 widget。根元素**必须是 inline-block**：inline-flex 的原子会让
 *  Chrome 的输入法把它后面刚打的第一个字重复一遍（Atd 实测，见它们的 chip-widget）。 */
class AttachmentAtom extends WidgetType {
  constructor(readonly attachmentId: string) {
    super();
  }

  /** 同一颗附件（id 相同）重建装饰时复用同一份 DOM，不重挂 React 根。 */
  override eq(other: AttachmentAtom): boolean {
    return other.attachmentId === this.attachmentId;
  }

  override toDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = "att-atom";
    const root = createRoot(dom);
    root.render(createElement(AtomPill, { attachmentId: this.attachmentId }));
    mounted.set(dom, root);
    return dom;
  }

  /** 点胶囊（含它内部的移除钮）要能收到事件：别让 CodeMirror 把点击当成"移动光标"吞掉。 */
  override ignoreEvent(): boolean {
    return true;
  }

  override destroy(dom: HTMLElement): void {
    const root = mounted.get(dom);
    mounted.delete(dom);
    // CodeMirror 可能在 React 提交途中销毁 widget：卸载排到微任务，避开那次提交
    queueMicrotask(() => root?.unmount());
  }
}

const mounted = new WeakMap<HTMLElement, Root>();

/** 令牌位置的胶囊本体：订阅 atomStore（附件集合与回调一变就重画），把附件对象翻成
 *  胶囊的扁平 props（胶囊是纯呈现，不认识我们的附件类型）。 */
function AtomPill({ attachmentId }: { attachmentId: string }) {
  useSyncExternalStore(subscribeAtoms, atomsVersion);
  const host = atomHost();
  const att = host.attachment(attachmentId);
  const [hovering, setHovering] = useState(false);
  const src = usePreviewSrc(att, hovering);
  if (att === undefined) return null;
  const picture = mediaOf(att);
  return createElement(AttachmentPill, {
    name: att.name,
    icon: att.kind === "image" ? "image" : "file",
    meta: att.kind === "file" ? fileMeta(att, host.t) : undefined,
    status: att.kind === "file" ? att.status : undefined,
    busy: att.kind === "file" && att.status === "uploading",
    tip: att.kind === "file" ? att.error : undefined,
    preview: src !== null && picture !== null ? { src, video: picture === "video" } : null,
    t: host.t,
    onOpen: att.kind === "image" ? () => host.onOpenImage(att) : undefined,
    onRetry: () => host.onRetry(att.id),
    onRemove: () => host.onRemove(att.id),
    onHoverChange: setHovering,
  });
}

/** 媒体判据（图片/视频）：图标名表就是单一事实源（图片部件一定是图片，名字没扩展名也算）。
 *  其余文件（pdf/zip/文本…）没有画面可预览，悬停不弹东西——用户定稿"仅限媒体文件"。 */
function mediaOf(att: Attachment): "image" | "video" | null {
  if (att.kind === "image") return "image";
  const icon = resolveFileIconName(att.name);
  return icon === "image" || icon === "video" ? icon : null;
}

/** 预览画面的字节来源。图片附件的字节一直在内存里（data URL）；文件附件的字节只有本端
 *  手里这一份（文件部件的字节引擎拿不回来，见 session/localMedia.ts），有 File 才建
 *  blob URL、收起即撤。壳选择器挑来的文件只有路径、没有字节——那种不弹画面（宁可没有，
 *  也不摆一块空白）。 */
function usePreviewSrc(att: Attachment | undefined, active: boolean): string | null {
  const [src, setSrc] = useState<string | null>(null);
  const data = att?.kind === "image" ? att.data : null;
  const mediaType = att?.kind === "image" ? att.mediaType : null;
  const file = att?.kind === "file" ? att.file : undefined;
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

function decorate(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, attachmentId } of tokensIn(state.doc.toString(), state.field(tokenTable))) {
    builder.add(from, to, Decoration.replace({ widget: new AttachmentAtom(attachmentId) }));
  }
  return builder.finish();
}

/** 令牌 → 原子装饰，并登记成原子范围。组合态期间**只 map 不重画**：重画正在组字的
 *  那一行旁边的 widget 会把输入法搞坏（Atd 实测）。 */
export const attachmentDecorations = StateField.define<DecorationSet>({
  create: decorate,
  update(decorations, transaction) {
    if (transaction.isUserEvent("input.type.compose")) return decorations.map(transaction.changes);
    return transaction.docChanged || transaction.effects.some((effect) => effect.is(addTokens))
      ? decorate(transaction.state)
      : decorations;
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});
