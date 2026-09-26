// 浏览器面板的客户端偏好（唯一事实源）：搜索引擎模板、地址栏行为。
//
// 只放**壳不需要知道**的项（壳侧要读的缩放存 UserDefaults，见 BrowserZoom.swift）。
// 读写在 localStorage——这些是纯展示/交互偏好，跟端口轮换无关。
import { useCallback, useEffect, useState } from "react";

export interface BrowserPrefs {
  /** 搜索模板：`{q}` 处填查询词。留空串 = 输入的搜索词也当地址试。 */
  searchTemplate: string;
  /** 地址栏是否把明显是搜索词的输入拿去搜索（关掉则一律当地址）。 */
  searchOnPlainText: boolean;
}

export const BROWSER_SEARCH_TEMPLATES: { id: string; label: string; template: string }[] = [
  { id: "bing", label: "Bing", template: "https://www.bing.com/search?q={q}" },
  { id: "google", label: "Google", template: "https://www.google.com/search?q={q}" },
  { id: "duckduckgo", label: "DuckDuckGo", template: "https://duckduckgo.com/?q={q}" },
  { id: "baidu", label: "百度", template: "https://www.baidu.com/s?wd={q}" },
];

export const DEFAULT_BROWSER_PREFS: BrowserPrefs = {
  searchTemplate: BROWSER_SEARCH_TEMPLATES[0]!.template,
  searchOnPlainText: true,
};

const KEY = "deepdive.browser.prefs";
const listeners = new Set<() => void>();
let cache: BrowserPrefs | null = null;

function read(): BrowserPrefs {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...DEFAULT_BROWSER_PREFS, ...(JSON.parse(raw) as Partial<BrowserPrefs>) } : DEFAULT_BROWSER_PREFS;
  } catch {
    // 无 localStorage（测试/受限环境）或坏值：用默认，不打断面板
    cache = DEFAULT_BROWSER_PREFS;
  }
  return cache;
}

export function browserPrefs(): BrowserPrefs { return read(); }

export function setBrowserPrefs(patch: Partial<BrowserPrefs>): void {
  const next = { ...read(), ...patch };
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* 无 localStorage：仅本次会话生效 */ }
  for (const notify of listeners) notify();
}

/** 订阅式读取（设置页改了，地址栏立刻用新模板）。 */
export function useBrowserPrefs(): [BrowserPrefs, (patch: Partial<BrowserPrefs>) => void] {
  const [value, setValue] = useState(read);
  useEffect(() => {
    const notify = () => setValue(read());
    listeners.add(notify);
    return () => { listeners.delete(notify); };
  }, []);
  const update = useCallback((patch: Partial<BrowserPrefs>) => setBrowserPrefs(patch), []);
  return [value, update];
}
