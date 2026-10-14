// 附件原子在编辑器里的呈现：把每枚令牌换成一个**行内原子**（替换装饰 + 原子范围）——
// 光标跨过它、退格整颗删掉、点它/悬停它照旧（复用 AttachmentPill）。
// 附件对象与动作不在编辑器状态里（状态只放令牌与附件 id），由 atomStore 供给——见那里的
// 注释：widget 是独立 React 根，得订阅才能跟着上传进度一起重画。
import { createElement, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RangeSetBuilder, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { AttachmentPill } from "../AttachmentPill";
import { atomHost, atomsVersion, subscribeAtoms } from "./atomStore";
import { addTokens, tokenTable, tokensIn } from "./attachmentTokens";

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

/** 令牌位置的胶囊本体：订阅 atomStore（附件集合与回调一变就重画）。 */
function AtomPill({ attachmentId }: { attachmentId: string }) {
  useSyncExternalStore(subscribeAtoms, atomsVersion);
  const host = atomHost();
  const att = host.attachment(attachmentId);
  if (att === undefined) return null;
  return createElement(AttachmentPill, {
    att,
    t: host.t,
    onRemove: host.onRemove,
    onRetry: host.onRetry,
    onOpenImage: host.onOpenImage,
  });
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
