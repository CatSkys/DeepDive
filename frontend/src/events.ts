// 应用内 CustomEvent 事件名唯一登记处（AUD-065）：App 键位 effect 派发、
// 各组件监听，全部经此常量——此前裸字符串散在收发两端，新接手者需全局
// 搜 "dd:" 才能发现对端。

export const DD_EVENTS = {
  /** 开/关听写（⌘D）。收发：App → composer/useComposerDictation。 */
  dictationToggle: "dd:dictation-toggle",
  /** 循环思考强度档位（⇧⌘E）。收发：useAppKeybinds/命令面板 → 输入框档位胶囊
   *  （components/composer/EffortPicker）。 */
  cycleEffort: "dd:cycle-effort",
  /** 把选中文字追加进输入框。收发：SelectionActions → Composer，
   *  CustomEvent detail 携带 { text }。 */
  composerAppend: "dd:composer-append",
  /** 打开设置页（可带分节）。收发：引导卡/命令面板 → App/Shell，
   *  CustomEvent detail 携带 { section?: string }。 */
  openSettings: "dd:open-settings",
  /** 把消息流里的「定时任务建议」带进新建表单。收发：AutomationProposalCard →
   *  App（打开设置→自动化并预填），CustomEvent detail 携带 AutomationProposal。 */
  automationDraft: "dd:automation-draft",
  /** 打开命令面板（⌘K）。收发：App 键位 → CommandPaletteHost。 */
  commandPalette: "dd:command-palette",
  /** 调起附件选择（命令面板「添加附件」）。收发：CommandPalette →
   *  useComposerAttachments（同 composer ＋ 按钮）。 */
  composerAttach: "dd:composer-attach",
} as const;

/** 派发一个应用内事件（window 冒泡阶段监听；detail 可选随事件携带）。 */
export function dispatchAppEvent(name: string, detail?: unknown): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/** 订阅一个应用内事件；返回退订函数。 */
export function onAppEvent(name: string, cb: (detail: unknown) => void): () => void {
  const listener = (e: Event) => cb((e as CustomEvent).detail);
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}
