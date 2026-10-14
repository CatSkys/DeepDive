// 输入框的文本层（CodeMirror 6，照 Atd 的 composer-editor 移植）：编辑、折行、光标、
// 选区、撤销、中文输入法组合都归它管；React 侧只镜像纯文本——`@`/命令菜单、草稿落盘、
// 发送裁决读的都是这份镜像，而**文本的真正持有者是编辑器**（外部要改稿一律走下面这个
// handle，别去 setState 里改一份影子文本）。
//
// 为什么不是 textarea：附件胶囊要能插进正文中间（行内原子），textarea 装不下元素。
// 附件怎么变成原子见 attachmentTokens.ts / attachmentDecorations.ts。
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { Compartment, EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder } from "@codemirror/view";
import { history, historyKeymap, insertNewline, standardKeymap } from "@codemirror/commands";
import { composerEditorTheme } from "./editorTheme";

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
  /** 纯文本。 */
  text(): string;
  /** 光标位（纯文本坐标）。 */
  caret(): number;
  /** 整篇替换：清空 / 草稿回填 / 预填（**会丢掉正文里的附件原子**，只作整篇来源用）。 */
  setText(value: string): void;
  /** 追加到末尾：听写落稿走它（保留正文里的附件原子）。 */
  appendText(value: string): void;
  /** 按纯文本坐标替换一段：`@`/命令菜单的插入走它（坐标→文档坐标由附件令牌层换算）。 */
  replacePlain(from: number, to: number, insert: string): void;
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
  /** ⌘V 粘进来的文件（图片那张老路）：编排方决定怎么摄入。 */
  onPasteFiles: (files: File[]) => void;
  /** 内容有没有高过一行（折行、或一行里塞不下）——由编辑器**自己量自己的排版**报出，
   *  编排方据此决定胶囊态还是展开态（进出两档门槛在那边，这里只报实测）。 */
  onOverflow: (tall: boolean) => void;
}

export const DraftEditor = forwardRef<DraftEditorHandle, DraftEditorProps>(function DraftEditor(
  { initialText, placeholder: hint, routing, onText, onCaret, onPasteFiles, onOverflow },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** 最新 props 的镜像：编辑器活在 React 渲染之外，回调得读"此刻"的值。 */
  const latest = useRef({ hint, routing, onText, onCaret, onPasteFiles, onOverflow });
  latest.current = { hint, routing, onText, onCaret, onPasteFiles, onOverflow };
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
    text: () => viewRef.current?.state.doc.toString() ?? "",
    caret: () => viewRef.current?.state.selection.main.head ?? 0,
    setText(value: string) {
      const view = viewRef.current;
      if (view === null) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        selection: EditorSelection.cursor(value.length),
      });
      view.focus();
    },
    appendText(value: string) {
      const view = viewRef.current;
      if (view === null || value === "") return;
      const current = view.state.doc.toString();
      const joined = current.trim() ? `${current.trimEnd()} ${value}` : value;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: joined },
        selection: EditorSelection.cursor(joined.length),
      });
    },
    replacePlain(from: number, to: number, insert: string) {
      const view = viewRef.current;
      if (view === null) return;
      const length = view.state.doc.length;
      const start = Math.max(0, Math.min(from, length));
      const end = Math.max(start, Math.min(to, length));
      view.dispatch({
        changes: { from: start, to: end, insert },
        selection: EditorSelection.cursor(start + insert.length),
      });
    },
    focus: () => viewRef.current?.focus(),
  }), []);

  return <div className="composer-editor" ref={hostRef} />;
});

/** 空稿提示：CodeMirror 自带的 placeholder 扩展（画在编辑器根上，不占文档位）。 */
function placeholderOf(hint: string): Extension {
  return hint ? placeholder(hint) : [];
}

/** 编辑器的全部扩展：主题 + 键位 + 选区自绘 + 变化回吐。 */
function extensions(
  latest: React.MutableRefObject<{
    routing: () => EditorKeyRouting;
    onText: (text: string) => void;
    onCaret: (offset: number) => void;
    onPasteFiles: (files: File[]) => void;
    onOverflow: (tall: boolean) => void;
  }>,
  slot: Compartment,
): Extension[] {
  return [
    history(),
    // 键路由最高优先：菜单、发送、组合态守卫都在这儿裁决（返回 true 即吃掉）
    Prec.highest(EditorView.domEventHandlers({
      keydown: (event, view) => routeKey(event, view, latest.current.routing()),
      paste: (event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (files.length === 0) return false;
        event.preventDefault();
        latest.current.onPasteFiles(files);
        return true;
      },
    })),
    // 每个键落到键盘事件最前面：组合态的开合要报给守卫（余波回车靠它判）
    EditorView.domEventObservers({
      compositionstart: () => latest.current.routing().compositionStart(),
      compositionend: () => { setTimeout(() => latest.current.routing().compositionEnd(), 0); },
    }),
    keymap.of([
      // standardKeymap 去掉 Enter：那个 Enter 归上面的路由（发送）与下面这条（换行）。
      // 它的 Esc（simplifySelection）也不在 standardKeymap 里——菜单的 Esc 归编排方。
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
      if (update.docChanged) latest.current.onText(update.state.doc.toString());
      if (update.docChanged || update.selectionSet) latest.current.onCaret(update.state.selection.main.head);
      if (update.docChanged || update.geometryChanged) reportOverflow(update.view, latest.current.onOverflow);
    }),
  ];
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
