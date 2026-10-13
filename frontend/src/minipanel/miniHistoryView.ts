// 迷你面板「会话历史」的取数与排布（纯函数，不含 React）：把 store 的会话摘要收敛成
// 历史行、按查询过滤、按日期分段。只管算——渲染在 MiniHistoryRows.tsx。
//
// 只列**快捷会话空间**的会话（用户 2026-10-13 定稿：历史按钮服务"接着上次的活儿"，
// 而面板就是快捷会话的窗口）。空间归属沿用侧栏同一条规则：摘要查不到映射时落回第一个
// 空间——两处口径必须一致，否则同一个会话在侧栏与历史里归属不同。
//
// 分段只有日期这一条轴（用户 2026-10-13 定稿：面板里的历史不做筛选，那排"排序与分组"
// 控件整个删掉）；段序是日期由新到旧，置顶恒成第一段。

import { sessionTitle } from "../session/sessionTitle";
import { bucketLabel } from "../session/sessionTime";
import type { SessionSummary } from "../types";

export interface HistoryItem {
  sessionId: string;
  title: string;
  updatedAt: number;
  running: boolean;
  unread: boolean;
  /** 会话工作目录：行菜单的「在 Finder 中打开 / 复制路径」要用。 */
  cwd?: string;
  pinned: boolean;
}

export interface HistorySection {
  /** React key：置顶段是 "pinned"，日期段是它的标签。 */
  key: string;
  /** 段标题；null = 不画标题。 */
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

/**
 * 按日期分段。**置顶恒成第一段**（与侧栏同一语言），且不再参与日期分组——否则同一个
 * 会话会在「置顶」和「今天」各出现一次。段内与段间一律按最近更新降序。
 */
export function groupByDate(
  items: readonly HistoryItem[],
  opts: { lang: "zh" | "en"; t: (zh: string) => string },
): HistorySection[] {
  const byUpdated = (a: HistoryItem, b: HistoryItem) => b.updatedAt - a.updatedAt;
  const sections: HistorySection[] = [];
  const pinned = items.filter((it) => it.pinned).sort(byUpdated);
  if (pinned.length > 0) sections.push({ key: "pinned", title: opts.t("置顶"), items: pinned });

  const rest = items.filter((it) => !it.pinned);
  if (rest.length === 0) return sections;
  const buckets = new Map<string, HistoryItem[]>();
  for (const it of rest) {
    const label = bucketLabel(it.updatedAt, opts.lang);
    const list = buckets.get(label);
    if (list) list.push(it);
    else buckets.set(label, [it]);
  }
  // 段序按段内最新一条降序（不靠 Map 的插入序——那取决于输入顺序，不是日期"今天在前"）
  const dated = [...buckets.entries()].map(([label, list]) => ({
    key: label,
    title: label,
    items: list.sort(byUpdated),
    newest: list.reduce((max, it) => Math.max(max, it.updatedAt), 0),
  }));
  dated.sort((a, b) => b.newest - a.newest);
  return [...sections, ...dated.map(({ key, title, items: list }) => ({ key, title, items: list }))];
}
