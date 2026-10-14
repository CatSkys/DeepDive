// 偏好状态 hook（AUD-063 从 store.tsx 拆出）：语言/外观三态/生效明暗/
// 键位覆盖/全局热键开关/侧栏宽/引导进度，以及客户端本地归档偏好。壳偏好持久化经 UserDefaults（set-pref），下发经 host-ready 后的
// prefs 推送与 themeChanged 实时推送——localStorage 会因端口轮换丢，这是
// 走壳的原因；纯客户端偏好（自动归档）才落 localStorage。只管偏好读写，
// 不管业务状态。
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_RETENTION, RETENTIONS, type ArchiveRetention } from "./autoArchive";
import { onHostEvent, sendToShell } from "./host";
import { formatHotkeySpec, parseKeybinds, type KeybindOverrides } from "./keybinds";
import { parseSelectionToolbar, type SelectionToolbarSettings } from "./settings/selectionToolbar";
import { parseSelectionCommands, type SelectionCommand } from "./settings/selectionCommands";

/** 单值本地偏好读取：无 localStorage（受限环境）或值非法一律回退默认。 */
function readPref<T>(key: string, fallback: T, parse: (raw: string) => T | null): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (parse(raw) ?? fallback);
  } catch { /* 无 localStorage（测试/受限环境）→ 默认 */ }
  return fallback;
}

/** 页面明暗的本地基准：外观三态最终落在壳的 `webView.appearance` 上，WebKit 因此把它
 *  报成本地媒体查询（运行时改 appearance 会即时翻转并触发 change，2026-10-09 实测）。
 *  这条通道丢不掉，所以页面明暗以它为准；壳的 themeChanged / prefs 推送是同值确认。 */
const SCHEME_QUERY = "(prefers-color-scheme: dark)";

export function usePrefs() {
  // 侧栏宽：壳 prefs（host-ready 时推送）为初值；setSidebarWidth 落点持久化。
  // 200–320 与 tokens.json size.sidebar.min/max 手工双写——改动须三处同步
  //（tokens.json / 此处 / 壳 DSHAppPrefs.swift）。
  const [sidebarWidth, setSidebarWidthState] = useState(240);
  const setSidebarWidth = useCallback((w: number) => {
    const clamped = Math.min(320, Math.max(200, Math.round(w)));
    setSidebarWidthState(clamped);
    sendToShell({ type: "set-pref", key: "sidebarWidth", value: clamped });
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty("--dsh-sidebar-w", `${sidebarWidth}px`);
  }, [sidebarWidth]);
  const [lang, setLangState] = useState<"zh" | "en">("zh");
  const setLang = useCallback((l: "zh" | "en") => {
    setLangState(l);
    sendToShell({ type: "set-pref", key: "language", value: l });
  }, []);
  // 首帧就与壳同档：只认媒体查询，不等那次推送——推送漏投会留下"壳已浅色、页面仍暗色"
  // 的半切窗口（2026-10-09 用户报：切成浅色模式后卡片仍暗、侧栏白字压在浅玻璃上）。
  const [schemeDark, setSchemeDark] = useState(() => window.matchMedia(SCHEME_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(SCHEME_QUERY);
    const onChange = () => setSchemeDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const [appearance, setAppearanceState] = useState<"system" | "light" | "dark">("dark");
  const [keybinds, setKeybindsState] = useState<KeybindOverrides>({});
  const [hotkeyOn, setHotkeyOnState] = useState(true);
  // 全局热键的当前值（壳推 spec，这里格式化成键帽串）。初值是壳默认 option+space 的显示串
  // ——事实源在 AppPaths.swift 的 hotkey 默认值；prefs 一到就被真值替换。
  const [hotkey, setHotkey] = useState("⌥Space");
  // 浏览器缩放（壳侧读 UserDefaults：壳在 didCommit 时要按它排版）
  const [browserZoomDefault, setBrowserZoomDefaultState] = useState(1);
  const [browserZoomRememberSite, setBrowserZoomRememberSiteState] = useState(true);
  const setBrowserZoomDefault = useCallback((value: number) => {
    setBrowserZoomDefaultState(value);
    sendToShell({ type: "browser-zoom", default: value });
  }, []);
  const setBrowserZoomRememberSite = useCallback((on: boolean) => {
    setBrowserZoomRememberSiteState(on);
    sendToShell({ type: "browser-zoom", rememberSite: on });
  }, []);
  // 标签休眠门槛（分钟；0 = 永不）——壳侧的看门计时器按它扫，所以也落 UserDefaults
  const [browserTabSleepMinutes, setBrowserTabSleepMinutesState] = useState(30);
  const setBrowserTabSleepMinutes = useCallback((minutes: number) => {
    setBrowserTabSleepMinutesState(minutes);
    sendToShell({ type: "browser-tabs", sleepMinutes: minutes });
  }, []);
  const setAppearance = useCallback((m: "system" | "light" | "dark") => {
    setAppearanceState(m);
    sendToShell({ type: "set-pref", key: "appearance", value: m });
  }, []);
  const setKeybinds = useCallback((next: KeybindOverrides) => {
    setKeybindsState(next);
    sendToShell({ type: "set-pref", key: "keybinds", value: JSON.stringify(next) });
  }, []);
  const setHotkeyOn = useCallback((v: boolean) => {
    setHotkeyOnState(v);
    sendToShell({ type: "set-pref", key: "hotkeyOn", value: v });
  }, []);
  // 选区工具条设置（划词）：壳推来的持久化值回灌，改动经壳落地（推送在 store 里
  // 与命令目录合成一份——同一份设置只有一个写入口）。
  const [selectionToolbar, setSelectionToolbarState] = useState<SelectionToolbarSettings>(() =>
    parseSelectionToolbar(readPref("deepdive.selectionToolbar", "", (raw) => raw)));
  const setSelectionToolbar = useCallback((next: SelectionToolbarSettings) => {
    setSelectionToolbarState(next);
  }, []);
  // 划词命令目录（JSON 串，结构见 settings/selectionCommands.ts；壳只存不解析）。
  // 初值不读 localStorage：没存过就每次启动从代码里重新种子，内置命令的名字因此
  // 跟着界面语言走；用户一旦编辑过，整份目录即成为用户数据（Atd 同款语义）。
  const [selectionCommands, setSelectionCommandsState] = useState<SelectionCommand[]>(() =>
    parseSelectionCommands(null));
  const setSelectionCommands = useCallback((next: SelectionCommand[]) => {
    setSelectionCommandsState(next);
    sendToShell({ type: "set-pref", key: "selectionCommands", value: JSON.stringify(next) });
  }, []);
  // 截图全局热键（spec 与开关都在壳；这里显示的键帽串由壳推来）。
  const [screenshotHotkey, setScreenshotHotkeyState] = useState("⌘⇧2");
  const [screenshotHotkeyOn, setScreenshotHotkeyOnState] = useState(true);
  const setScreenshotHotkeyOn = useCallback((v: boolean) => {
    setScreenshotHotkeyOnState(v);
    sendToShell({ type: "set-pref", key: "screenshotHotkeyOn", value: v });
  }, []);
  // 新手引导进度（JSON 串，结构见 onboarding/useOnboarding.ts）：壳只存不解析。
  const [onboarding, setOnboardingState] = useState("");
  const setOnboarding = useCallback((v: string) => {
    setOnboardingState(v);
    sendToShell({ type: "set-pref", key: "onboarding", value: v });
  }, []);
  // 自动归档（客户端偏好，localStorage；默认关——归档单向不可撤销）。
  const [autoArchive, setAutoArchiveState] = useState(() =>
    readPref("deepdive.autoArchive", false, (raw) => raw === "1"));
  const [archiveRetention, setArchiveRetentionState] = useState<ArchiveRetention>(() =>
    readPref("deepdive.archiveRetention", DEFAULT_RETENTION, (raw) =>
      (RETENTIONS.some((r) => r.id === raw) ? (raw as ArchiveRetention) : null)));
  const setAutoArchive = useCallback((v: boolean) => {
    localStorage.setItem("deepdive.autoArchive", v ? "1" : "0");
    setAutoArchiveState(v);
  }, []);
  const setArchiveRetention = useCallback((v: ArchiveRetention) => {
    localStorage.setItem("deepdive.archiveRetention", v);
    setArchiveRetentionState(v);
  }, []);
  // 基准详情卡显隐（模型菜单 ⓘ；用户 2026-10-11 定稿：持久化、默认开）。
  // **消费方经 store 读这一份**（主窗只有 store 那一份 prefs；菜单每次打开都重挂，
  // 自己 new 一份 state 会永远从默认值起——2026-10-14 用户报"关了它每次开还出现"）。
  const [modelDetail, setModelDetailState] = useState(true);
  // 快捷会话默认空间目录（壳保证存在；D14）——注册与跳转都以它为锚。
  const [quickWorkspacePath, setQuickWorkspacePathState] = useState<string | null>(null);
  const setModelDetail = useCallback((v: boolean) => {
    setModelDetailState(v);
    sendToShell({ type: "set-pref", key: "modelDetail", value: v });
  }, []);
  // 壳偏好下发（host-ready / get-prefs）：侧栏宽、语言、生效明暗、键位覆盖；
  // appearance=system 时系统明暗变化由壳经 themeChanged 实时推送——themeChanged 只到
  // 这里（不经 installHostBridge 的 handler 表），与主题相关只有 store 状态一处写入。
  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd === "prefs" && payload) {
      const p = payload as { sidebarWidth?: number; language?: string; schemeDark?: boolean; appearance?: string; keybinds?: string; hotkeyOn?: boolean; hotkey?: string; onboarding?: string; browserZoomDefault?: number; browserZoomRememberSite?: boolean; browserTabSleepMinutes?: number; modelDetail?: boolean; quickWorkspacePath?: string; selectionToolbar?: string; selectionCommands?: string; screenshotHotkey?: string; screenshotHotkeyOn?: boolean };
      if (typeof p.sidebarWidth === "number" && p.sidebarWidth >= 200 && p.sidebarWidth <= 320) setSidebarWidthState(p.sidebarWidth);
      if (p.language === "zh" || p.language === "en") setLangState(p.language);
      if (typeof p.schemeDark === "boolean") setSchemeDark(p.schemeDark);
      if (p.appearance === "system" || p.appearance === "light" || p.appearance === "dark") setAppearanceState(p.appearance);
      if (typeof p.keybinds === "string") setKeybindsState(parseKeybinds(p.keybinds));
      if (typeof p.hotkeyOn === "boolean") setHotkeyOnState(p.hotkeyOn);
      if (typeof p.hotkey === "string" && p.hotkey) setHotkey(formatHotkeySpec(p.hotkey));
      if (typeof p.onboarding === "string") setOnboardingState(p.onboarding);
      if (typeof p.browserZoomDefault === "number") setBrowserZoomDefaultState(p.browserZoomDefault);
      if (typeof p.browserZoomRememberSite === "boolean") setBrowserZoomRememberSiteState(p.browserZoomRememberSite);
      if (typeof p.browserTabSleepMinutes === "number") setBrowserTabSleepMinutesState(p.browserTabSleepMinutes);
      if (typeof p.modelDetail === "boolean") setModelDetailState(p.modelDetail);
      if (typeof p.quickWorkspacePath === "string" && p.quickWorkspacePath) setQuickWorkspacePathState(p.quickWorkspacePath);
      if (typeof p.selectionToolbar === "string") setSelectionToolbarState(parseSelectionToolbar(p.selectionToolbar));
      if (typeof p.selectionCommands === "string") setSelectionCommandsState(parseSelectionCommands(p.selectionCommands));
      if (typeof p.screenshotHotkey === "string" && p.screenshotHotkey) setScreenshotHotkeyState(formatHotkeySpec(p.screenshotHotkey));
      if (typeof p.screenshotHotkeyOn === "boolean") setScreenshotHotkeyOnState(p.screenshotHotkeyOn);
    }
    if (cmd === "hotkeyChanged") {
      const p = payload as { which?: string; spec?: string } | undefined;
      if (p?.which === "screenshot" && p.spec) setScreenshotHotkeyState(formatHotkeySpec(p.spec));
    }
    if (cmd === "themeChanged") {
      const dark = (payload as { dark?: boolean } | undefined)?.dark;
      if (typeof dark === "boolean") setSchemeDark(dark);
    }
  }), []);
  // 生效明暗 → data-theme（代码块等 [data-theme] 规则消费）
  useEffect(() => {
    document.documentElement.dataset.theme = schemeDark ? "dark" : "light";
  }, [schemeDark]);
  return {
    sidebarWidth, setSidebarWidth,
    lang, setLang,
    schemeDark,
    appearance, setAppearance,
    keybinds, setKeybinds,
    hotkeyOn, setHotkeyOn,
    hotkey, setHotkey,
    browserZoomDefault, setBrowserZoomDefault,
    browserZoomRememberSite, setBrowserZoomRememberSite,
    browserTabSleepMinutes, setBrowserTabSleepMinutes,
    modelDetail, setModelDetail,
    quickWorkspacePath,
    onboarding, setOnboarding,
    selectionToolbar, setSelectionToolbar,
    selectionCommands, setSelectionCommands,
    screenshotHotkey, screenshotHotkeyOn, setScreenshotHotkeyOn,
    autoArchive, setAutoArchive,
    archiveRetention, setArchiveRetention,
  };
}
