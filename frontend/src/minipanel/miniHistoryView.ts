// 迷你面板「会话历史」脸的取数与排布（纯函数，不含 React、不读写偏好）：把 store 的
// 会话摘要收敛成历史行、按查询过滤、按偏好分组排序。只管算——渲染在 MiniHistory.tsx，
// 偏好存取在 miniHistoryPrefs.ts，两边的边界都由这里的类型钉住。
//
// 只列**快捷会话空间**的会话（用户 2026-10-13 定稿：历史按钮服务"接着上次的活儿"，
// 而面板就是快捷会话的窗口）。空间归属沿用侧栏同一条规则：摘要查不到映射时落回第一个
// 空间——两处口径必须一致，否则同一个会话在侧栏与历史里归属不同。

import { sessionTitle } from "../session/sessionTitle";
import { bucketLabel } from "../session/sessionTime";
import type { SessionSummary } from "../types";

export interface HistoryItem {
  sessionId: string;
  title: string;
  updatedAt: number;
  running: boolean;
  unread: boolean;
  /** 摘要自带的智能体预设（分组轴之一；空 = 默认）。 */
  agentPreset?: string;
  /** 会话工作目录：行菜单的「在 Finder 中打开 / 复制路径」要用。 */
  cwd?: string;
  pinned: boolean;
}

export type HistoryGroup = "date" | "status" | "agent" | "none";
export type HistorySort = "updated" | "title";

export interface HistorySection {
  /** React key；也编码了分组轴（`status:running` / `agent:<预设>` / `date:<标签>`）。 */
  key: string;
  /** 段标题；null = 不画标题（「不分组」）。 */
  title: string | null;
  items: HistoryItem[];
}

export function historyItems(
  sessions: readonly SessionSummary[],
  opts: {
    /** 只列这个空间（快捷会话）。 */
    workspaceId: string;
    /** 摘要查不到空间归属时的落点（与侧栏同一规则）。 */
    fallbackWorkspaceId: string | undefined;
    workspaceOf: ReadonlyMap<string, string>;
    pinned: ReadonlySet<string>;
    unread: ReadonlySet<string>;
    lang: "zh" | "en";
  },
): HistoryItem[] {
  return sessions
    .filter((s) => (opts.workspaceOf.get(s.sessionId) ?? opts.fallbackWorkspaceId) === opts.workspaceId)
    .map((s) => ({
      sessionId: s.sessionId,
      title: sessionTitle(s, opts.lang),
      updatedAt: s.updatedAt,
      running: s.running,
      unread: opts.unread.has(s.sessionId),
      agentPreset: s.agentPreset,
      cwd: s.cwd,
      pinned: opts.pinned.has(s.sessionId),
    }));
}

/** 标题子串过滤（大小写不敏感、去首尾空白；空查询 = 全量）。 */
export function filterHistory(items: readonly HistoryItem[], query: string): HistoryItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((it) => it.title.toLowerCase().includes(q));
}

/** 状态分组轴的固定段序（与侧栏行首槽位的优先级同序：在跑 > 未读 > 其余）。 */
const STATUS_ORDER = ["status:running", "status:unread", "status:done"];

function axisKey(it: HistoryItem, group: HistoryGroup, lang: "zh" | "en"): string {
  switch (group) {
    case "date": return `date:${bucketLabel(it.updatedAt, lang)}`;
    case "status": return it.running ? "status:running" : it.unread ? "status:unread" : "status:done";
    case "agent": return `agent:${it.agentPreset ?? ""}`;
    case "none": return "";
  }
}

function axisTitle(key: string, t: (zh: string) => string): string {
  if (key.startsWith("date:")) return key.slice(5);
  if (key === "status:running") return t("运行中");
  if (key === "status:unread") return t("未读");
  if (key === "status:done") return t("已完成");
  // 智能体：段标题就是预设名，空 = 默认（排序上它排最前，见下方 ordered.sort）
  return key.slice(6) || t("默认");
}

/**
 * 分组 + 排序。**置顶恒成第一段**（与侧栏同一语言），且不再参与轴分组——否则同一个会话
 * 会在「置顶」和「今天」各出现一次。
 * 段序：日期 = 段内最新一条降序（今天 → 昨天 → 上周 → 各月）；状态 = 固定序；智能体 =
 * 名字升序（默认在最前）；不分组 = 单一无标题段。
 */
export function groupAndSort(
  items: readonly HistoryItem[],
  opts: { group: HistoryGroup; sort: HistorySort; lang: "zh" | "en"; t: (zh: string) => string },
): HistorySection[] {
  const collator = new Intl.Collator(opts.lang, { numeric: true });
  const compare = (a: HistoryItem, b: HistoryItem) =>
    opts.sort === "title" ? collator.compare(a.title, b.title) : b.updatedAt - a.updatedAt;

  const sections: HistorySection[] = [];
  const pinned = items.filter((it) => it.pinned).sort(compare);
  if (pinned.length > 0) sections.push({ key: "pinned", title: opts.t("置顶"), items: pinned });

  const rest = items.filter((it) => !it.pinned);
  if (rest.length === 0) return sections;
  if (opts.group === "none") {
    sections.push({ key: "all", title: null, items: [...rest].sort(compare) });
    return sections;
  }

  const buckets = new Map<string, HistoryItem[]>();
  for (const it of rest) {
    const key = axisKey(it, opts.group, opts.lang);
    const list = buckets.get(key);
    if (list) list.push(it);
    else buckets.set(key, [it]);
  }
  const grouped = [...buckets.entries()].map(([key, list]) => ({
    key,
    list: list.sort(compare),
    newest: list.reduce((max, it) => Math.max(max, it.updatedAt), 0),
  }));
  if (opts.group === "date") grouped.sort((a, b) => b.newest - a.newest);
  else if (opts.group === "status") grouped.sort((a, b) => STATUS_ORDER.indexOf(a.key) - STATUS_ORDER.indexOf(b.key));
  else grouped.sort((a, b) => a.key.localeCompare(b.key));

  return [...sections, ...grouped.map((g) => ({ key: g.key, title: axisTitle(g.key, opts.t), items: g.list }))];
}
