// 应用内 CustomEvent 事件名唯一登记处（AUD-065）：App 键位 effect 派发、
// 各组件监听，全部经此常量——此前裸字符串散在收发两端，新接手者需全局
// 搜 "dd:" 才能发现对端。

export const DD_EVENTS = {
  /** 聚焦侧栏搜索框（快捷键 ⌘F）。收发：App → Sidebar。 */
  focusSearch: "dd:focus-search",
  /** 开/关听写（⌘D）。收发：App → composer/useComposerDictation。 */
  dictationToggle: "dd:dictation-toggle",
  /** 循环思考强度档位（⌘⇧E）。收发：App → SessionHeader。 */
  cycleEffort: "dd:cycle-effort",
  /** 把选中文字追加进输入框。收发：SelectionActions → Composer，
   *  CustomEvent detail 携带 { text }。 */
  composerAppend: "dd:composer-append",
} as const;

/** 派发一个应用内事件（window 冒泡阶段监听）。 */
export function dispatchAppEvent(name: string): void {
  window.dispatchEvent(new CustomEvent(name));
}
