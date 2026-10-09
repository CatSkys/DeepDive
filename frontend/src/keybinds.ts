// 应用内快捷键注册表：默认键位 + 用户覆盖（经壳持久化 UserDefaults，
// set-pref "keybinds" 存 JSON 字符串）。覆盖格式 Record<id, {combo?, off?}>；
// combo 为规范化显示串（修饰序固定 ⌃⌥⇧⌘ + 主键，如 "⌘N"、"⇧⌘E"）——与
// comboOf 的产出**逐字节相同**，否则按下去匹配不上（⌘⇧E 与 ⇧⌘E 是两个字面量）。

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
  { id: "cycle-effort", zh: "思考强度切换", en: "Cycle reasoning effort", combo: "⇧⌘E" },
  { id: "open-settings", zh: "设置", en: "Settings", combo: "⌘," },
  // id 保持 command-palette（用户覆盖按 id 持久化，改名即丢）；标签随用户口径
  // 叫「搜索」——搜索就是命令面板这一件事（入口：⌘K / 顶栏搜索钮 / 侧栏搜索行）。
  { id: "command-palette", zh: "搜索", en: "Search", combo: "⌘K" },
  { id: "find", zh: "页内查找", en: "Find in conversation", combo: "⌘F" },
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
      { keys: "@", zh: "引用文件与会话", en: "Reference a file or session" },
      { keys: "/", zh: "命令候选", en: "Command candidates" },
      { keys: "⌘V", zh: "粘贴图片为附件", en: "Paste an image as an attachment" },
      { keys: "↑ ↓", zh: "引用与命令候选上下移动", en: "Move in the reference / command list" },
      { keys: "Tab", zh: "选中当前候选", en: "Pick the highlighted candidate" },
      { keys: "Esc", zh: "收起候选列表", en: "Dismiss the candidate list" },
    ],
  },
  {
    zh: "浏览器页面（页面有焦点时）", en: "Browser page (when it has focus)",
    items: [
      { keys: "⌘L", zh: "地址栏", en: "Address bar" },
      { keys: "⌘F", zh: "页内查找", en: "Find in page" },
      { keys: "⌘G / ⇧⌘G", zh: "下一个 / 上一个匹配", en: "Next / previous match" },
      { keys: "⌘R", zh: "重新加载页面", en: "Reload the page" },
      { keys: "⌘[ / ⌘]", zh: "后退 / 前进", en: "Back / forward" },
      { keys: "⌘= / ⌘-", zh: "网页放大 / 缩小", en: "Zoom the page in / out" },
      { keys: "⌘0", zh: "网页实际大小", en: "Reset page zoom" },
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
  {
    zh: "菜单与系统（macOS 接管）", en: "Menu and system (macOS handles these)",
    items: [
      { keys: "⌘W", zh: "关闭窗口（收起面板，应用留在菜单栏）", en: "Close the window (hides the panel; the app stays in the menu bar)" },
      { keys: "⌘O", zh: "打开工作区…（文件菜单）", en: "Open workspace… (File menu)" },
      { keys: "⌘Z / ⇧⌘Z", zh: "撤销 / 重做", en: "Undo / redo" },
      { keys: "⌘X / ⌘C / ⌘V / ⌘A", zh: "剪切 / 拷贝 / 粘贴 / 全选", en: "Cut / copy / paste / select all" },
      { keys: "⌘+ / ⌘- / ⌘0", zh: "界面放大 / 缩小 / 实际大小", en: "Zoom the interface in / out / reset" },
      { keys: "⌃⌘F", zh: "切换全屏", en: "Toggle full screen" },
      { keys: "⌘M", zh: "最小化", en: "Minimize" },
      { keys: "⌘H / ⌥⌘H", zh: "隐藏本应用 / 隐藏其他", en: "Hide this app / hide others" },
      { keys: "⌘Q", zh: "退出 DeepDive", en: "Quit DeepDive" },
    ],
  },
];

/** ⌥1-9 切第 N 个项目空间（固定键位，不入改键表）。认**物理键位**（`e.code`）不认字符：
 *  按着 ⌥ 敲主键盘 1-9 产出的是 ¡™£¢∞§¶•ª（现场 U.S. 布局实测），`e.key` 永远不是数字，
 *  拿它做判断等于这条快捷键不存在。`e.code` 与布局和修饰键都无关。 */
export function workspaceDigitOf(e: KeyboardEvent): number | undefined {
  if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return undefined;
  const m = /^Digit([1-9])$/.exec(e.code);
  return m ? Number(m[1]) : undefined;
}

/** 壳侧的全局热键 spec（`"option+space"`，HotKeyManager 的键名表）→ 键帽串。
 *  壳在 prefs/rebind 里推的就是 spec，不转换就会把「option+space」原样显示在设置页。
 *  修饰序与键名都取 comboOf/normKey 同一套（⌃⌥⇧⌘ + Space/↩/Esc/Tab/⌫）。 */
const HOTKEY_MODS: Record<string, string> = { control: "⌃", option: "⌥", shift: "⇧", command: "⌘" };
const HOTKEY_KEYS: Record<string, string> = { space: "Space", return: "↩", esc: "Esc", tab: "Tab", backspace: "⌫" };

export function formatHotkeySpec(spec: string): string {
  const parts = spec.split("+").map((p) => p.trim()).filter(Boolean);
  const key = parts.pop() ?? "";
  const mods = ["control", "option", "shift", "command"]
    .filter((m) => parts.includes(m))
    .map((m) => HOTKEY_MODS[m])
    .join("");
  return mods + (HOTKEY_KEYS[key] ?? key.toUpperCase());
}

export function parseKeybinds(raw: unknown): KeybindOverrides {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const parsed = JSON.parse(raw) as KeybindOverrides;
    if (!parsed || typeof parsed !== "object") return {};
    // 旧录制把 Ctrl 记成「⌃⌘X」（comboOf 曾经把 ctrl 也算成 ⌘），归一到「⌃X」——
    // 否则那条绑定按现在的匹配规则永远不响，用户只会看到「改了没用」。
    const out: KeybindOverrides = {};
    for (const [id, v] of Object.entries(parsed)) {
      out[id] = v?.combo ? { ...v, combo: v.combo.replace(/^⌃⌘/, "⌃") } : v;
    }
    return out;
  } catch {
    return {}; // 持久化值损坏：回退默认键位
  }
}

/** 被 macOS 系统或本应用主菜单占着的组合：按键先到它们手里，绑了永远不会响
 *  （清单对应 apps/macos/Sources/DSHminiApp/MainMenu.swift 与系统全局键）。
 *  录制时据此拒绝——不然用户会得到一个「看着绑好了、按下去没反应」的键位。 */
export const RESERVED_COMBOS: ReadonlySet<string> = new Set([
  // 主菜单（MainMenu.swift）
  "⌘Q", "⌘W", "⌘M", "⌘H", "⌥⌘H", "⌘O",
  "⌃⌘F", "⌘+", "⌘-", "⌘0",
  "⌘Z", "⇧⌘Z", "⌘X", "⌘C", "⌘V", "⌘A",
  // 系统全局键（Spotlight / 表情与符号 / 应用与窗口切换）
  "⌘Space", "⌃⌘Space", "⌘Tab", "⌘`",
]);

/** 一个键位能不能绑：原因见 BindReject。绑不上的三种情形各有各的说法，
 *  所以这里返回原因而不是布尔——设置页要照着提示用户。 */
export type BindReject = "need-modifier" | "reserved" | "taken";

export function bindRejection(
  id: string,
  combo: string,
  overrides: KeybindOverrides | undefined,
  /** 当下生效的全局热键显示串（⌥Space）：系统级热键会先把键吃掉，绑同一个组合是死键。 */
  globalHotkey?: string,
): { kind: BindReject; other?: KeybindDef } | undefined {
  // 裸键（K、Enter、Esc、方向键…）不进改键表：它们在各交互面里都有固定语义，
  // 抢占只会让打字/选择乱套，且显示串分不清「K」是字母 K 还是某个键位。
  if (!/[⌘⌃⌥]/.test(combo)) return { kind: "need-modifier" };
  if (RESERVED_COMBOS.has(combo) || (globalHotkey && combo === globalHotkey)) {
    return { kind: "reserved" };
  }
  const other = KEYBIND_DEFS.find(
    (d) => d.id !== id && !isOff(d.id, overrides) && comboFor(d.id, overrides) === combo,
  );
  return other ? { kind: "taken", other } : undefined;
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

/** KeyboardEvent → 规范化显示串（修饰序 ⌃⌥⇧⌘ + 主键）；纯修饰键返回 undefined。
 *  Ctrl 就是 ⌃，不折算成 ⌘——折算了显示串会说谎（按 Ctrl+K 写「⌃⌘K」），而 ⌘K 与
 *  Ctrl+K 本来是两条不同的键位。 */
export function comboOf(e: KeyboardEvent): string | undefined {
  const key = normKey(e);
  if (!key) return undefined;
  // ⇧ 显式记录（⇧⌘E 与 ⌘E 是不同绑定，不能靠字母大写隐含）
  const mods =
    (e.ctrlKey ? "⌃" : "") +
    (e.altKey ? "⌥" : "") +
    (e.shiftKey ? "⇧" : "") +
    (e.metaKey ? "⌘" : "");
  return mods + key;
}
