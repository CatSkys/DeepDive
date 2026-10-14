// 输入框富文本层的 CodeMirror 主题：把编辑器观感对齐原来那个 textarea——字号随正文、
// 行高 20、上下内距 8、透明底、无焦点环、上限 160 内滚（超出不露裸滚动条）。
// 只管"长什么样"；行为与键位见 DraftEditor.tsx。
import { EditorView } from "@codemirror/view";

export const composerEditorTheme = EditorView.theme({
  "&": {
    fontSize: "var(--dsh-font-size-base)",
    color: "var(--ink)",
    background: "transparent",
    // 单行高与胶囊同源（--composer-h）：空稿时编辑器也占满那一行
    minHeight: "var(--composer-h)",
  },
  "&.cm-focused": { outline: "none" },
  /* 编辑器自己滚：上限 160 与旧 textarea 的 max-height 同值（上下内距也搬到这里）。
     滚动条不露（UI-SPEC §1.1：内容超出不画裁切线、不露裸滚动条）。 */
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "20px",
    padding: "8px 0",
    maxHeight: "160px",
    overflowY: "auto",
    scrollbarWidth: "none",
  },
  ".cm-scroller::-webkit-scrollbar": { display: "none" },
  ".cm-content": { padding: "0", overflowWrap: "anywhere", caretColor: "var(--ink)" },
  ".cm-line": { padding: "0" },
  /* 占位符不折行：附件占掉宽度后文本列会变窄，提示语折行会把空框撑成两行高
     （旧 textarea 那条同款约束，别删）。 */
  ".cm-placeholder": { color: "var(--ink-3)", whiteSpace: "nowrap" },
  // 自己画的插入符与选区（drawSelection）：默认那根太细、选区色也要跟主题走
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ink)", borderLeftWidth: "1.5px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    background: "var(--selection)",
  },
});
