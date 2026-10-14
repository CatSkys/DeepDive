// 输入框的文本层（CodeMirror 6，照 Atd 的 composer-editor 移植）：编辑、折行、光标、
// 选区、撤销、中文输入法组合都归它管。**文本的真正持有者是编辑器**，React 侧那份纯文本
// 只是镜像（`@`/命令菜单、草稿落盘、发送裁决读它）；外部要改稿一律走下面这个 handle，
// 别去 setState 里改一份影子文本。
//
// 文档里正文与附件令牌混在一起（见 attachmentTokens）：对外有两条读法——**文档文本**
// （编辑器自己用）与**纯文本**（令牌整段丢掉，菜单/草稿/斜杠裁决用）。菜单给的插入点是
// 纯文本坐标，写进文档前在这里换算。附件画成行内原子见 attachmentDecorations。
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { Compartment, EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder } from "@codemirror/view";
import { history, historyKeymap, insertNewline, standardKeymap } from "@codemirror/commands";
import { composerEditorTheme } from "./editorTheme";
import { attachmentDecorations } from "./attachmentDecorations";
import {
  addTokens, docOffset, plainOffset, plainOf, segmentsOf, SENTINELS, tokenEntry, tokenOf, tokenTable, tokensIn,
  type DocSegment,
} from "./attachmentTokens";

/** 键与组合态怎么路由：归编排方（它持最新状态），编辑器只负责在对的时机问它。 */
export interface EditorKeyRouting {
  /** 菜单开着且吃掉这个键 → true（↑↓ 选行、Enter/Tab 落、Esc 收起）。 */
  menuKey(event: KeyboardEvent): boolean;
  /** Enter 发送；繁忙时用哪个修饰键取另一行为，归编排方判。 */
  submit(event: KeyboardEvent): void;
  /** 组合态守卫：确认候选的那记回车余波要吞掉（useCompositionGuard）。 */
  swallow(event: KeyboardEvent): boolean;
  compositionStart(): void;
  compositionEnd(): void;
}

export interface DraftEditorHandle {
  /** 纯文本（令牌丢掉的那一份）。 */
  text(): string;
  /** 光标位（纯文本坐标）。 */
  caret(): number;
  /** 整篇替换：清空 / 草稿回填 / 预填。**会丢掉正文里的附件令牌**（草稿只存文本），
   *  只作"整篇来源"用；正文追加走 appendText、按位插入走 replacePlain。 */
  setText(value: string): void;
  /** 追加到末尾：听写落稿、文件夹引用走它（保留正文里的附件原子）。 */
  appendText(value: string): void;
  /** 按纯文本坐标替换一段：`@`/命令菜单的插入走它。 */
  replacePlain(from: number, to: number, insert: string): void;
  /** 在光标处插一颗附件（插完补一个空格好接着打）。 */
  insertAttachment(attachmentId: string): void;
  /** 摘掉某颗附件在正文里的令牌（React 那边随后收到"它没了"的回吐）。 */
  removeAttachment(attachmentId: string): void;
  /** 发送载荷的分段：文本段与附件 id 按**文档序**交替。 */
  payload(): DocSegment[];
  focus(): void;
}

export interface DraftEditorProps {
  /** 挂载那一刻的文本；之后由 handle 命令驱动（不做受控回灌）。 */
  initialText: string;
  /** 空稿时的提示语（听写中会换成 partial，所以随渲染变）。 */
  placeholder: string;
  /** 每渲染一次都会拿到新的，键处理里读到的永远是最新值。 */
  routing: () => EditorKeyRouting;
  /** 纯文本变化（React 侧镜像）。 */
  onText: (text: string) => void;
  /** 光标位变化（纯文本坐标）。 */
  onCaret: (offset: number) => void;
  /** 某颗附件的令牌从正文里没了（退格整颗删、或删掉含它的整段）。 */
  onAttachmentRemoved: (attachmentId: string) => void;
  /** ⌘V 粘进来的文件（图片那张老路）：编排方决定怎么摄入。 */
  onPasteFiles: (files: File[]) => void;
  /** 内容有没有高过一行——编辑器自己量自己的排版报出，编排方据此决定胶囊态/展开态。 */
  onOverflow: (tall: boolean) => void;
}

export const DraftEditor = forwardRef<DraftEditorHandle, DraftEditorProps>(function DraftEditor(
  { initialText, placeholder: hint, routing, onText, onCaret, onAttachmentRemoved, onPasteFiles, onOverflow },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** 最新 props 的镜像：编辑器活在 React 渲染之外，回调得读"此刻"的值。 */
  const latest = useRef({ hint, routing, onText, onCaret, onAttachmentRemoved, onPasteFiles, onOverflow });
  latest.current = { hint, routing, onText, onCaret, onAttachmentRemoved, onPasteFiles, onOverflow };
  const initial = useRef(initialText);
  const placeholderSlot = useRef(new Compartment());

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initial.current,
        selection: EditorSelection.cursor(initial.current.length),
        extensions: extensions(latest, placeholderSlot.current),
      }),
    });
    viewRef.current = view;
    reportOverflow(view, latest.current.onOverflow);
    view.focus();
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  // 提示语随渲染变（听写 partial）→ 经 compartment 重配，不重建编辑器（不丢撤销栈）
  useLayoutEffect(() => {
    viewRef.current?.dispatch({ effects: placeholderSlot.current.reconfigure(placeholderOf(hint)) });
  }, [hint]);

  useImperativeHandle(ref, () => ({
    text: () => currentPlain(viewRef.current),
    caret: () => {
      const view = viewRef.current;
      return view === null ? 0 : toPlain(view, view.state.selection.main.head);
    },
    setText(value: string) {
      const view = viewRef.current;
      if (view === null) return;
      const doc = value.replace(SENTINELS, "");
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
        selection: EditorSelection.cursor(doc.length),
      });
      view.focus();
    },
    appendText(value: string) {
      const view = viewRef.current;
      if (view === null || value === "") return;
      const doc = view.state.doc.toString();
      const current = plainOf(doc, view.state.field(tokenTable));
      // 有内容先补一个空格；只改"尾巴"那一段，正文里的附件原子原地不动
      const keep = current.trimEnd();
      const joined = keep ? `${keep} ${value}` : value;
      const from = docOffset(keep.length, doc, view.state.field(tokenTable));
      view.dispatch({
        changes: { from, to: doc.length, insert: joined.slice(keep.length) },
        selection: EditorSelection.cursor(from + joined.length - keep.length),
      });
      view.focus();
    },
    replacePlain(from: number, to: number, insert: string) {
      const view = viewRef.current;
      if (view === null) return;
      const doc = view.state.doc.toString();
      const table = view.state.field(tokenTable);
      const text = insert.replace(SENTINELS, "");
      const start = docOffset(from, doc, table);
      view.dispatch({
        changes: { from: start, to: docOffset(to, doc, table), insert: text },
        selection: EditorSelection.cursor(start + text.length),
      });
    },
    insertAttachment(attachmentId: string) {
      const view = viewRef.current;
      if (view === null) return;
      const entry = tokenEntry(attachmentId);
      const at = Math.max(0, Math.min(view.state.selection.main.head, view.state.doc.length));
      const insert = `${tokenOf(entry.id)} `;
      view.dispatch({
        changes: { from: at, insert },
        selection: EditorSelection.cursor(at + insert.length),
        effects: addTokens.of([entry]),
      });
      view.focus();
    },
    removeAttachment(attachmentId: string) {
      const view = viewRef.current;
      if (view === null) return;
      const hit = [...tokensOf(view)].find((token) => token.attachmentId === attachmentId);
      if (hit === undefined) return;
      view.dispatch({ changes: { from: hit.from, to: hit.to } });
    },
    payload: () => currentSegments(viewRef.current),
    focus: () => viewRef.current?.focus(),
  }), []);

  return <div className="composer-editor" ref={hostRef} />;
});

/** 文档里每一枚令牌的位置（移除时按附件 id 找它）。 */
function* tokensOf(view: EditorView) {
  yield* tokensIn(view.state.doc.toString(), view.state.field(tokenTable));
}

/** 纯文本读法（令牌整段丢掉）。 */
function currentPlain(view: EditorView | null): string {
  return view === null ? "" : plainOf(view.state.doc.toString(), view.state.field(tokenTable));
}

/** 发送载荷的分段（文档序）。 */
function currentSegments(view: EditorView | null): DocSegment[] {
  return view === null ? [] : segmentsOf(view.state.doc.toString(), view.state.field(tokenTable));
}

/** 文档坐标 → 纯文本坐标（光标位喂给 `@` 语法时用）。 */
function toPlain(view: EditorView, docPos: number): number {
  return plainOffset(docPos, view.state.doc.toString(), view.state.field(tokenTable));
}

/** 空稿提示：CodeMirror 自带的 placeholder 扩展（画在编辑器根上，不占文档位）。 */
function placeholderOf(hint: string): Extension {
  return hint ? placeholder(hint) : [];
}

/** 编辑器的全部扩展：主题 + 键位 + 选区自绘 + 变化回吐 + 附件令牌层。 */
function extensions(
  latest: React.MutableRefObject<{
    routing: () => EditorKeyRouting;
    onText: (text: string) => void;
    onCaret: (offset: number) => void;
    onAttachmentRemoved: (attachmentId: string) => void;
    onPasteFiles: (files: File[]) => void;
    onOverflow: (tall: boolean) => void;
  }>,
  slot: Compartment,
): Extension[] {
  return [
    // 表必须先声明：装饰层在 update 里读它（状态字段按声明序求值）
    tokenTable,
    attachmentDecorations,
    history(),
    Prec.highest(EditorView.domEventHandlers({
      keydown: (event, view) => routeKey(event, view, latest.current.routing()),
      paste: (event, view) => handlePaste(event, view, latest.current),
    })),
    EditorView.domEventObservers({
      compositionstart: () => latest.current.routing().compositionStart(),
      compositionend: () => { setTimeout(() => latest.current.routing().compositionEnd(), 0); },
    }),
    keymap.of([
      // standardKeymap 去掉 Enter：那个 Enter 归上面的路由（发送）与下面这条（换行）
      ...standardKeymap.filter((binding) => binding.key !== "Enter"),
      { key: "Enter", run: newline },
      { key: "Enter", shift: newline },
      ...historyKeymap,
    ]),
    drawSelection(),
    EditorView.contentAttributes.of({ spellcheck: "true" }),
    composerEditorTheme,
    slot.of([]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        latest.current.onText(currentPlain(update.view));
        reportRemoved(update.view, update.startState.doc.toString(), latest.current.onAttachmentRemoved);
      }
      if (update.docChanged || update.selectionSet) {
        latest.current.onCaret(toPlain(update.view, update.state.selection.main.head));
      }
      if (update.docChanged || update.geometryChanged) reportOverflow(update.view, latest.current.onOverflow);
    }),
  ];
}

/** 粘贴：图片走老路（交给编排方摄入）；文本里若混着哨兵（从别处复制走样的），
 *  剥掉再落——不然它会冒充附件令牌。 */
function handlePaste(
  event: ClipboardEvent,
  view: EditorView,
  latest: { onPasteFiles: (files: File[]) => void },
): boolean {
  const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
  if (files.length > 0) {
    event.preventDefault();
    latest.onPasteFiles(files);
    return true;
  }
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (!SENTINELS.test(text)) return false;
  event.preventDefault();
  const insert = text.replace(SENTINELS, "");
  const head = view.state.selection.main.head;
  view.dispatch({ changes: { from: head, insert }, selection: EditorSelection.cursor(head + insert.length) });
  return true;
}

/** 换行：组合中不插（那一记归输入法）——与旧 textarea 的 Shift+Enter 同一条口径。 */
function newline(view: EditorView): boolean {
  return !view.compositionStarted && insertNewline(view);
}

/** 一次按键的裁决顺序：组合态守卫 → 菜单 → 裸 Enter 发送；其余放行给编辑器。 */
function routeKey(event: KeyboardEvent, view: EditorView, routing: EditorKeyRouting): boolean {
  if (routing.swallow(event)) return true;
  if (routing.menuKey(event)) return true;
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    routing.submit(event);
    return true;
  }
  void view;
  return false;
}

/** 内容有没有高过一行：最后那个可视行块的 top > 0 就是前面还有行（折了行）。
 *  用 CodeMirror 自己量出来的排版（lineBlockAt），不读外层盒子的 clientHeight——
 *  外层那个数在测试与真实环境里含义不同（也会被全局 stub 带偏）。 */
function reportOverflow(view: EditorView, report: (tall: boolean) => void): void {
  report(view.state.doc.lines > 1 || view.lineBlockAt(view.state.doc.length).top > 0);
}

/** 文档里"少了的附件"回吐给编排方：React 那份集合据此把附件摘掉（正文说了算）。
 *  表是只增不删的，所以拿旧文档文本也能查出旧令牌代表哪颗附件。 */
function reportRemoved(
  view: EditorView,
  previousDoc: string,
  report: (attachmentId: string) => void,
): void {
  const table = view.state.field(tokenTable);
  const before = new Set(refsOf(segmentsOf(previousDoc, table)));
  const after = new Set(refsOf(segmentsOf(view.state.doc.toString(), table)));
  for (const id of before) if (!after.has(id)) report(id);
}

function refsOf(segments: DocSegment[]): string[] {
  return segments.flatMap((segment) => (typeof segment === "string" ? [] : [segment.attachmentId]));
}
