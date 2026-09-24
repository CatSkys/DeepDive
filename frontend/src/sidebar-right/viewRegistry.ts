// 右侧边栏注册的页型（移植官方 ui-sidebar-right 的 tab 型注册表：每个型自带 id、kind、
// 标题与 guide 条目）。官方注册表是给插件用的扩展座位（它的 files / documentpreview 就是
// 外来的型）；本仓只有这三个型，所以这里是一份静态声明而不是注册 API——等真的出现第二个
// 提供方再谈扩展座位，不做空抽象。
//
// 官方默认页规则照抄：**恰好一个 guide 条目就直接开它的页**。本仓 status 是唯一的
// guide 条目，所以打开面板直接落在"会话"页（浏览器槽位 + 能力分区）。

import type { TabKind } from "./panelState";

export interface PanelView {
  /** 实现身份（官方 id）。 */
  id: string;
  kind: TabKind;
  /** 页签文案（打开时定格）。 */
  title: string;
  /** guide 条目：列进"指南"页；有 guide 的型才出现在指南里。 */
  guide?: { title: string; description: string };
}

export const PANEL_VIEWS: PanelView[] = [
  {
    id: "deepdive/status",
    kind: "status",
    title: "会话",
    guide: { title: "会话状态", description: "任务与计划、产物、后台任务" },
  },
  {
    id: "deepdive/browser",
    kind: "browser",
    title: "浏览器",
    guide: { title: "浏览器", description: "打开网页、看智能体在做什么" },
  },
  {
    id: "deepdive/guide",
    kind: "guide",
    title: "指南",
  },
];

/** 默认页：唯一一个 guide 条目直接开它的页（官方规则）。 */
export function defaultView(): PanelView {
  const entries = PANEL_VIEWS.filter((v) => v.guide !== undefined);
  if (entries.length === 1) return entries[0]!;
  return PANEL_VIEWS.find((v) => v.kind === "guide")!;
}

/** guide 页里列出的条目（除 guide 自己）。 */
export function guideEntries(): PanelView[] {
  return PANEL_VIEWS.filter((v) => v.guide !== undefined && v.kind !== "guide");
}
