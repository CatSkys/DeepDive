// 选区工具条设置的形状与默认值（唯一事实源）：壳侧按同一份字段解析
// （`ToolbarSetParams` ← 桥的 `selection-toolbar-set`），设置卡与壳推来的回灌都读它。
// 默认照 Atd：开启；只在按住 ⌥ 选字时浮出；状态 HUD 开。

export type SelectionActivationMode = "always" | "hold" | "toggle";
export type SelectionActivationKey = "option" | "command" | "shift";

/** 工具条上的一个命令：`id` 即引擎命令名（与迷你面板命令卡同一份目录）。 */
export interface SelectionToolbarCommand {
  id: string;
  name: string;
}

export interface SelectionToolbarSettings {
  enabled: boolean;
  /** 哪些选中会浮出：always 任何选中 / hold 按住组合时 / toggle 监听态（连按两次组合开合）。 */
  activation: SelectionActivationMode;
  /** hold 与 toggle 用的组合键（hold 默认 ⌥）。 */
  activationKeys: SelectionActivationKey[];
  /** toggle 模式的状态 HUD。 */
  showHud: boolean;
  /** 不显示工具条的 App（bundle id）。 */
  excludedBundleIds: string[];
  /** 浮出哪些命令（上限与壳契约一致）。 */
  commands: SelectionToolbarCommand[];
}

export const MAX_EXCLUDED_APPS = 100;
/** 工具条命令上限（与壳侧迷你面板命令卡同一上限）。 */
export const MAX_TOOLBAR_COMMANDS = 64;

export const DEFAULT_SELECTION_TOOLBAR: SelectionToolbarSettings = {
  enabled: true,
  activation: "hold",
  activationKeys: ["option"],
  showHud: true,
  excludedBundleIds: [],
  commands: [],
};

const MODES: SelectionActivationMode[] = ["always", "hold", "toggle"];
const KEYS: SelectionActivationKey[] = ["option", "command", "shift"];

/** 壳推来的 JSON 串 → 设置（读取即边界校验：非法的字段回默认，未知字段丢弃）。 */
export function parseSelectionToolbar(raw: string | null | undefined): SelectionToolbarSettings {
  if (!raw) return DEFAULT_SELECTION_TOOLBAR;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return DEFAULT_SELECTION_TOOLBAR; }
  const o = (value ?? {}) as Partial<Record<keyof SelectionToolbarSettings, unknown>>;
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : DEFAULT_SELECTION_TOOLBAR.enabled,
    activation: MODES.includes(o.activation as SelectionActivationMode)
      ? (o.activation as SelectionActivationMode)
      : DEFAULT_SELECTION_TOOLBAR.activation,
    activationKeys: Array.isArray(o.activationKeys)
      ? KEYS.filter((k) => (o.activationKeys as unknown[]).includes(k))
      : DEFAULT_SELECTION_TOOLBAR.activationKeys,
    showHud: typeof o.showHud === "boolean" ? o.showHud : DEFAULT_SELECTION_TOOLBAR.showHud,
    excludedBundleIds: Array.isArray(o.excludedBundleIds)
      ? (o.excludedBundleIds as unknown[]).filter((v): v is string => typeof v === "string").slice(0, MAX_EXCLUDED_APPS)
      : [],
    commands: Array.isArray(o.commands)
      ? (o.commands as unknown[])
        .map((c) => c as { id?: unknown; name?: unknown })
        .filter((c) => typeof c.id === "string" && typeof c.name === "string")
        .map((c) => ({ id: c.id as string, name: c.name as string }))
        .slice(0, MAX_TOOLBAR_COMMANDS)
      : [],
  };
}

/** 组合键的键帽串（设置卡与 HUD 提示同款读法）。 */
export function activationKeycap(keys: SelectionActivationKey[]): string {
  const parts = keys.map((k) => (k === "option" ? "⌥" : k === "command" ? "⌘" : "⇧"));
  return parts.join("") || "—";
}
