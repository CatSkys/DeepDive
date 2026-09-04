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
  { id: "search", zh: "搜索会话", en: "Search sessions", combo: "⌘F" },
  { id: "toggle-sidebar", zh: "收起 / 展开侧栏", en: "Toggle sidebar", combo: "⌘\\" },
  { id: "dictation", zh: "听写", en: "Dictation", combo: "⌘D" },
  { id: "cycle-effort", zh: "思考强度切换", en: "Cycle reasoning effort", combo: "⌘⇧E" },
  { id: "open-settings", zh: "设置", en: "Settings", combo: "⌘," },
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
