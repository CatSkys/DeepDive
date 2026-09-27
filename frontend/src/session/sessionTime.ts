// 会话列表的时间显示：相对时间（fmtTime）与分组标签（bucketLabel）。
// 纯函数、无副作用——单独成文件是为了让 Sidebar 保持体量，也便于单测直接钉边界。
// 文案按 lang 现生成，交给 i18n 词典走（Sidebar 不再自己拼）。

export function fmtTime(updatedAt: number, lang: "zh" | "en"): string {
  const diff = Date.now() - updatedAt;
  const m = Math.floor(diff / 60000);
  if (m < 1) return lang === "zh" ? "刚刚" : "now";
  if (m < 60) return `${m}${lang === "zh" ? " 分" : "m"}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}${lang === "zh" ? " 小时" : "h"}`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}${lang === "zh" ? " 天" : "d"}`;
  return `${Math.floor(d / 7)}${lang === "zh" ? " 周" : "w"}`;
}

export function bucketLabel(updatedAt: number, lang: "zh" | "en"): string {
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const diff = now - updatedAt;
  if (diff < day) {
    const d = new Date(updatedAt);
    const t = new Date(now);
    return d.getDate() === t.getDate() ? (lang === "zh" ? "今天" : "Today") : (lang === "zh" ? "昨天" : "Yesterday");
  }
  if (diff < 7 * day) return lang === "zh" ? "上周" : "This week";
  const d = new Date(updatedAt);
  return `${d.getMonth() + 1}${lang === "zh" ? " 月" : ""}`;
}
