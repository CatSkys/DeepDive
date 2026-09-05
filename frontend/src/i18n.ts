// Lightweight i18n: Chinese source strings are the keys (identity in zh),
// English translations live in EN. Missing keys fall back to the Chinese
// source — a sweep can ship incrementally without blanking the UI.
// English terms follow the official dsh web frontend (New Chat / Search /
// Reasoning / Queue / Archive …) so the two surfaces read alike.
//
// Usage: const { t, tt } = useT();  t("搜索") · tt(`保存失败：${m}`, `Save failed: ${m}`)
import { useStore } from "./store";

export type Lang = "zh" | "en";


import { EN } from "./i18n-en";

// Module-level current language: plain helpers (formatters, tool-row
// summaries) can call t()/tt() without hook plumbing. Components still use
// useT() so a language switch re-renders them and re-runs those helpers.
let currentLang: Lang = "zh";

/** zh 源串 → en；未收录回退源串（清扫可增量落地）。 */
export function translate(s: string, lang: Lang = currentLang): string {
  if (lang !== "en") return s;
  return EN[s] ?? s;
}

function render(zh: string, en: string, lang: Lang, vars?: Record<string, string | number>): string {
  let out = lang === "zh" ? zh : en;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

export function tt(zh: string, en: string, vars?: Record<string, string | number>): string {
  return render(zh, en, currentLang, vars);
}

export function t(s: string): string {
  return translate(s);
}

export type TFunc = {
  t: (s: string) => string;
  tt: (zh: string, en: string, vars?: Record<string, string | number>) => string;
  lang: Lang;
};

/** t/tt 闭包按 lang 缓存：useT 每渲染返回同一引用——把 t 放进 effect
 *  依赖不再引发每渲染重跑（SettingsPage ArchivedSection 曾因新闭包身份
 * 陷入 fetch→setState→重渲→再 fetch 的无限拉取循环）。 */
const tFuncCache = new Map<Lang, TFunc>();

export function useT(): TFunc {
  const { lang } = useStore();
  currentLang = lang;
  let fn = tFuncCache.get(lang);
  if (!fn) {
    fn = { t: (s) => translate(s, lang), tt: (zh, en, vars) => render(zh, en, lang, vars), lang };
    tFuncCache.set(lang, fn);
  }
  return fn;
}
