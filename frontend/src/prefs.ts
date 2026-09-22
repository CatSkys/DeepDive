// 偏好状态 hook（AUD-063 从 store.tsx 拆出）：语言/外观三态/生效明暗/
// 键位覆盖/全局热键开关/侧栏宽/自进化/会话记忆/引导进度，以及客户端本地
// 归档偏好。壳偏好持久化经 UserDefaults（set-pref），下发经 host-ready 后的
// prefs 推送与 themeChanged 实时推送——localStorage 会因端口轮换丢，这是
// 走壳的原因；纯客户端偏好（自动归档）才落 localStorage。只管偏好读写，
// 不管业务状态。
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_RETENTION, RETENTIONS, type ArchiveRetention } from "./autoArchive";
import { onHostEvent, sendToShell } from "./host";
import { parseKeybinds, type KeybindOverrides } from "./keybinds";

/** 单值本地偏好读取：无 localStorage（受限环境）或值非法一律回退默认。 */
function readPref<T>(key: string, fallback: T, parse: (raw: string) => T | null): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (parse(raw) ?? fallback);
  } catch { /* 无 localStorage（测试/受限环境）→ 默认 */ }
  return fallback;
}

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
  const [schemeDark, setSchemeDark] = useState(true);
  const [appearance, setAppearanceState] = useState<"system" | "light" | "dark">("dark");
  const [keybinds, setKeybindsState] = useState<KeybindOverrides>({});
  const [hotkeyOn, setHotkeyOnState] = useState(true);
  // 自进化（实验能力）：默认关——开关在设置→自进化 里，壳持久化（装配层启动时读它）
  const [evolutionEnabled, setEvolutionEnabledState] = useState(false);
  // 会话记忆（实验能力）：默认关——开关在设置→记忆 里，壳持久化（装配层启动时读它）
  const [sessionMemoryEnabled, setSessionMemoryEnabledState] = useState(false);
  /** 开关开着却没挂上的原因（依赖缺失 / 上次启动崩溃被自动隔离）：设置页要说明白，
   *  否则用户看到的就是"打开着但没生效"。空 = 正常。 */
  const [sessionMemoryBlocked, setSessionMemoryBlockedState] = useState<string | null>(null);
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
  const setEvolutionEnabled = useCallback((v: boolean) => {
    setEvolutionEnabledState(v);
    sendToShell({ type: "set-pref", key: "evolutionEnabled", value: v });
  }, []);
  const setSessionMemoryEnabled = useCallback((v: boolean) => {
    setSessionMemoryEnabledState(v);
    sendToShell({ type: "set-pref", key: "sessionMemoryEnabled", value: v });
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
  // 壳偏好下发（host-ready / get-prefs）：侧栏宽、语言、生效明暗、键位覆盖；
  // appearance=system 时系统明暗变化由壳经 themeChanged 实时推送。
  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd === "prefs" && payload) {
      const p = payload as { sidebarWidth?: number; language?: string; schemeDark?: boolean; appearance?: string; keybinds?: string; hotkeyOn?: boolean; evolutionEnabled?: boolean; sessionMemoryEnabled?: boolean; sessionMemoryBlocked?: string | null; onboarding?: string };
      if (typeof p.sidebarWidth === "number" && p.sidebarWidth >= 200 && p.sidebarWidth <= 320) setSidebarWidthState(p.sidebarWidth);
      if (p.language === "zh" || p.language === "en") setLangState(p.language);
      if (typeof p.schemeDark === "boolean") setSchemeDark(p.schemeDark);
      if (p.appearance === "system" || p.appearance === "light" || p.appearance === "dark") setAppearanceState(p.appearance);
      if (typeof p.keybinds === "string") setKeybindsState(parseKeybinds(p.keybinds));
      if (typeof p.hotkeyOn === "boolean") setHotkeyOnState(p.hotkeyOn);
      if (typeof p.evolutionEnabled === "boolean") setEvolutionEnabledState(p.evolutionEnabled);
      if (typeof p.sessionMemoryEnabled === "boolean") setSessionMemoryEnabledState(p.sessionMemoryEnabled);
      if (typeof p.sessionMemoryBlocked === "string" || p.sessionMemoryBlocked === null) {
        setSessionMemoryBlockedState(p.sessionMemoryBlocked ?? null);
      }
      if (typeof p.onboarding === "string") setOnboardingState(p.onboarding);
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
    evolutionEnabled, setEvolutionEnabled,
    sessionMemoryEnabled, setSessionMemoryEnabled,
    sessionMemoryBlocked,
    onboarding, setOnboarding,
    autoArchive, setAutoArchive,
    archiveRetention, setArchiveRetention,
  };
}
