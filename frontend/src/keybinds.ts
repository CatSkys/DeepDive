// 应用内快捷键注册表：默认键位 + 用户覆盖（经壳持久化 UserDefaults，
// set-pref "keybinds" 存 JSON 字符串）。覆盖格式 Record<id, {combo?, off?}>；
// combo 为规范化显示串（修饰序固定 ⌃⌥⇧⌘ + 主键，如 "⌘N"、"⌘⇧E"）。

export interface KeybindDef {
  id: string;
  zh: string;
  en: string;
  /** 默认组合（规范化显示串）。 */
  combo: string;
}

export type KeybindOverrides = Record<string, { combo?: string; off?: boolean }>;

export const KEYBIND_DEFS: KeybindDef[] = [
  { id: "new-session", zh: "新建会话", en: "New session", combo: "⌘N" },
  { id: "toggle-sidebar", zh: "收起 / 展开侧栏", en: "Toggle sidebar", combo: "⌘B" },
  { id: "dictation", zh: "听写", en: "Dictation", combo: "⌘D" },
  { id: "cycle-effort", zh: "思考强度切换", en: "Cycle reasoning effort", combo: "⌘⇧E" },
  { id: "open-settings", zh: "设置", en: "Settings", combo: "⌘," },
  // id 保持 command-palette（用户覆盖按 id 持久化，改名即丢）；标签随用户口径
  // 叫「搜索」——搜索就是命令面板这一件事（入口：⌘K / 顶栏搜索钮 / 侧栏搜索行）。
  { id: "command-palette", zh: "搜索", en: "Search", combo: "⌘K" },
];

/** 固定键位（不可改键，故不在 KEYBIND_DEFS 里）：实现在各自交互面内（输入框在
 *  Composer、面板在 CommandPalette、选项在 Cards…），本表只做设置页的展示事实源
 *  ——改任何一处的按键语义时同步这里。 */
export interface FixedKeybindItem { keys: string; zh: string; en: string }
export interface FixedKeybindGroup { zh: string; en: string; items: FixedKeybindItem[] }

export const FIXED_KEYBINDS: FixedKeybindGroup[] = [
  {
    zh: "全局", en: "Global",
    items: [
      { keys: "⌥1-9", zh: "切换到第 N 个项目", en: "Switch to project N" },
    ],
  },
  {
    zh: "输入框", en: "Composer",
    items: [
      { keys: "Enter", zh: "发送", en: "Send" },
      { keys: "⇧Enter", zh: "换行", en: "New line" },
      { keys: "⌘Enter", zh: "会话运行时取另一种行为（排队 / 插话）", en: "While a turn runs: the other of queue / steer" },
      { keys: "↑ ↓", zh: "引用与命令候选上下移动", en: "Move in the reference / command list" },
      { keys: "Tab", zh: "选中当前候选", en: "Pick the highlighted candidate" },
      { keys: "Esc", zh: "收起候选列表", en: "Dismiss the candidate list" },
    ],
  },
  {
    zh: "搜索面板", en: "Search panel",
    items: [
      { keys: "↑ ↓", zh: "移动", en: "Move" },
      { keys: "Enter", zh: "执行选中项", en: "Run the highlighted row" },
      { keys: "Esc", zh: "关闭", en: "Close" },
    ],
  },
  {
    zh: "弹层与对话框", en: "Overlays and dialogs",
    items: [
      { keys: "Esc", zh: "关闭弹层 / 取消对话框", en: "Close the overlay / cancel the dialog" },
      { keys: "Enter", zh: "确认（提问、输入弹窗）", en: "Confirm (question and prompt dialogs)" },
      { keys: "⌘Enter", zh: "创建项目（新建项目弹窗）", en: "Create (new-project dialog)" },
    ],
  },
  {
    zh: "问答卡片", en: "Question cards",
    items: [
      { keys: "↑ ↓ / Tab", zh: "在选项间移动", en: "Move between options" },
      { keys: "Enter / Space", zh: "选择当前项", en: "Choose the highlighted option" },
    ],
  },
];

export function parseKeybinds(raw: unknown): KeybindOverrides {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const parsed = JSON.parse(raw) as KeybindOverrides;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {}; // 持久化值损坏：回退默认键位
  }
}

/** 用户覆盖后的生效组合（off 时仍返回 combo 供灰显）。 */
export function comboFor(id: string, overrides: KeybindOverrides | undefined): string | undefined {
  return overrides?.[id]?.combo ?? KEYBIND_DEFS.find((d) => d.id === id)?.combo;
}

export function isOff(id: string, overrides: KeybindOverrides | undefined): boolean {
  return !!overrides?.[id]?.off;
}

/** 主键标准化：字母大写、常见键名映射；未识别返回 undefined（不可绑）。 */
function normKey(e: KeyboardEvent): string | undefined {
  const k = e.key;
  if (/^[a-z]$/i.test(k)) return k.toUpperCase();
  if (/^[0-9]$/.test(k)) return k;
  const map: Record<string, string> = {
    Escape: "Esc", Enter: "↩", Tab: "Tab", " ": "Space",
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    Backspace: "⌫", Delete: "⌦", ",": ",", ".": ".", "\\": "\\", "/": "/",
    "-": "-", "=": "=", ";": ";", "'": "'", "[": "[", "]": "]",
  };
  return map[k];
}

/** KeyboardEvent → 规范化显示串（修饰序 ⌃⌥⇧⌘ + 主键）；纯修饰键返回 undefined。 */
export function comboOf(e: KeyboardEvent): string | undefined {
  const key = normKey(e);
  if (!key) return undefined;
  // ⇧ 显式记录（⌘⇧E 与 ⌘E 是不同绑定，不能靠字母大写隐含）
  const mods =
    (e.ctrlKey ? "⌃" : "") +
    (e.altKey ? "⌥" : "") +
    (e.shiftKey ? "⇧" : "") +
    (e.metaKey || e.ctrlKey ? "⌘" : "");
  return mods + key;
}
