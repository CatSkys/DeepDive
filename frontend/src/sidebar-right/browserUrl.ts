// 侧栏浏览器地址栏的 HTTP(S) 允许表（移植官方 @deepseek-ai/dsh-client-ui-sidebar-browser
// 的 client/browser/url.ts）。只管「一串输入能不能变成导航目标」，不管载体与历史。
// 拒绝面是官方的固定集合：空、畸形、非 http/https、带内嵌凭据、以及本应用自己的 origin。

/** 地址长度上限：它同时约束持久化下来的导航状态（官方同名常量）。 */
export const MAX_BROWSER_URL_LENGTH = 16384;

/** 一个规范化的导航目标。 */
export type BrowserTarget = {
  kind: "https" | "http";
  url: string;
  /** 未观察到页面标题前的占位标题（官方取 hostname）。 */
  title: string;
};

/** 地址在导航前被拒的原因。 */
export type BrowserAddressFailure = "empty" | "invalid" | "protocol" | "credentials" | "application-origin";

export type BrowserAddressResult =
  | { ok: true; target: BrowserTarget }
  | { ok: false; reason: BrowserAddressFailure };

/** 带 scheme 判定：`example.com:8080` 的 `example.com:` 不是 scheme，`http:` 是。 */
const HAS_SCHEME = /^[A-Za-z][A-Za-z\d+.-]*:(?!\d+(?:[/?#]|$))/u;

/**
 * 解析一次地址栏输入。
 * @param input 用户输入或 typed-open 传入的地址。
 * @param applicationOrigin 当前 SPA 文档的 origin；命中即拒（防止页面把自己嵌进自己）。
 */
export function parseBrowserAddress(input: string, applicationOrigin?: string): BrowserAddressResult {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  if (trimmed.length > MAX_BROWSER_URL_LENGTH) return { ok: false, reason: "invalid" };
  const candidate = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "credentials" };
  if (url.protocol === "https:" || url.protocol === "http:") {
    if (applicationOrigin !== undefined && applicationOrigin !== "null") {
      try {
        if (url.origin === new URL(applicationOrigin).origin) return { ok: false, reason: "application-origin" };
      } catch { /* applicationOrigin 畸形：无从比较，按官方一样放行 */ }
    }
    return {
      ok: true,
      target: {
        kind: url.protocol === "https:" ? "https" : "http",
        url: url.href,
        title: url.hostname,
      },
    };
  }
  return { ok: false, reason: "protocol" };
}

/**
 * 搜索模板填充：`{q}` 处填 URL 编码后的查询词（参考实现 `Engine.url(for:template:)` 同义）。
 * 模板缺 `{q}` 时返回 null——宁可当地址试，也不猜一个错的搜索 URL。
 */
export function searchUrlFor(query: string, template: string): string | null {
  const trimmed = query.trim();
  if (trimmed === "" || !template.includes("{q}")) return null;
  const filled = template.replace("{q}", encodeURIComponent(trimmed));
  try {
    const url = new URL(filled);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** 看着像不像"要搜索的词"：有空格、或没有点/斜杠、也不是 localhost 这类裸主机。 */
export function looksLikeSearch(input: string): boolean {
  const text = input.trim();
  if (text === "") return false;
  // 自带 scheme（http:、https:、别的协议）→ 明说要当地址，不搜（畸形交给地址解析去拒）
  if (HAS_SCHEME.test(text)) return false;
  if (/\s/u.test(text)) return true;
  // 裸主机名（含 localhost 与 IPv4）不搜；含点但没别的结构的也算"像域名"，交给地址解析
  if (/^localhost(:\d+)?(\/|$)/iu.test(text)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/u.test(text)) return false;
  return !/^[^\s/]+\.[A-Za-z]{2,}(:\d+)?(\/|$)/u.test(text);
}

/** 补全列表里的**简写地址**：`https://search.bilibili.com/all?v=x` → `search.bilibili.com/all`。
 *  去 scheme 与 www.、去结尾斜杠；查询串与锚点不带（那截是噪音，标题与全量地址兜着语义）。
 *  解析不出（罕见：历史里只可能有解析过的地址）就原样返回。 */
export function shortAddress(url: string): string {
  try {
    const parsed = new URL(url);
    const host = `${parsed.hostname.replace(/^www\./, "")}${parsed.port ? `:${parsed.port}` : ""}`;
    const path = parsed.pathname.replace(/(\/$)/, "");
    return `${host}${path}`;
  } catch {
    return url;
  }
}
