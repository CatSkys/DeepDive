// 浏览器主动访问过的地址（最近优先，最多 20 条）——地址栏补全的候选源。
//
// 它是**我们自己的**记录，不是浏览历史面板（历史在后面的块里做）：只用来在地址栏里
// 补全"刚去过哪"，键 `deepdive.browser.recents`，坏值当没有。
const KEY = "deepdive.browser.recents";
const LIMIT = 20;

export interface BrowserRecent { url: string; title: string }

export function browserRecents(): BrowserRecent[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is BrowserRecent =>
      typeof item === "object" && item !== null &&
      typeof (item as BrowserRecent).url === "string" && typeof (item as BrowserRecent).title === "string");
  } catch {
    // 无 localStorage 或坏值：当没有记录，不打断地址栏
    return [];
  }
}

/** 记一次访问（同 URL 去重并提到最前）。 */
export function rememberVisit(url: string, title: string): void {
  if (!/^https?:/u.test(url)) return;
  const next = [{ url, title: title || url }, ...browserRecents().filter((item) => item.url !== url)].slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* 无 localStorage：本次会话内不补全 */ }
}

/** 按输入前缀/子串过滤候选（大小写不敏感，最多 6 条）。 */
export function completeRecents(input: string): BrowserRecent[] {
  const text = input.trim().toLowerCase();
  if (text === "") return [];
  return browserRecents()
    .filter((item) => item.url.toLowerCase().includes(text) || item.title.toLowerCase().includes(text))
    .slice(0, 6);
}
