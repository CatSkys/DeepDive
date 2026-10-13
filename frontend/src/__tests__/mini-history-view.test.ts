// 迷你面板「会话历史」脸的取数/过滤/分组排序：纯函数单测，钉住四条口径——
// ① 只列快捷会话空间（映射缺失落回第一空间，与侧栏同规则）；
// ② 搜索大小写不敏感、空查询全量；
// ③ 置顶恒成第一段且不参与轴分组（否则同一会话出现两次）；
// ④ 段序：日期按段内最新降序 / 状态固定序 / 智能体名字升序（默认在最前）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filterHistory, groupAndSort, historyItems, type HistoryItem } from "../minipanel/miniHistoryView";
import type { SessionSummary } from "../types";

const NOW = new Date("2026-10-13T15:00:00+08:00").getTime();
const HOUR = 3600_000;
const DAY = 24 * HOUR;

beforeEach(() => vi.setSystemTime(NOW));
afterEach(() => vi.useRealTimers());

const summary = (sessionId: string, updatedAt: number, extra: Partial<SessionSummary> = {}): SessionSummary => ({
  sessionId,
  updatedAt,
  running: false,
  blank: false,
  ...extra,
});

const item = (sessionId: string, title: string, extra: Partial<HistoryItem> = {}): HistoryItem => ({
  sessionId,
  title,
  updatedAt: NOW,
  running: false,
  unread: false,
  pinned: false,
  ...extra,
});

const t = (zh: string) => zh;

describe("historyItems", () => {
  it("只列给定空间的会话；摘要查不到映射时落回第一空间（与侧栏同规则）", () => {
    const sessions = [
      summary("s-quick", NOW, { projections: { asOfSeq: 1, values: { title: "快捷里的" } } }),
      summary("s-other", NOW, { projections: { asOfSeq: 1, values: { title: "别处的" } } }),
      summary("s-unmapped", NOW, { projections: { asOfSeq: 1, values: { title: "没映射的" } } }),
    ];
    const items = historyItems(sessions, {
      workspaceId: "ws-quick",
      fallbackWorkspaceId: "ws-quick",
      workspaceOf: new Map([["s-quick", "ws-quick"], ["s-other", "ws-other"]]),
      pinned: new Set(["s-quick"]),
      unread: new Set(["s-unmapped"]),
      lang: "zh",
    });
    expect(items.map((i) => i.sessionId)).toEqual(["s-quick", "s-unmapped"]);
    expect(items[0]).toMatchObject({ title: "快捷里的", pinned: true, unread: false });
    expect(items[1]).toMatchObject({ title: "没映射的", pinned: false, unread: true });
  });

  it("标题走 sessionTitle 的回退（空白会话 → 新会话）", () => {
    const items = historyItems([summary("s1", NOW, { blank: true })], {
      workspaceId: "ws",
      fallbackWorkspaceId: "ws",
      workspaceOf: new Map(),
      pinned: new Set(),
      unread: new Set(),
      lang: "zh",
    });
    expect(items[0]?.title).toBe("新会话");
  });
});

describe("filterHistory", () => {
  const items = [item("a", "Upgrade plan"), item("b", "补一版文档"), item("c", "upgrade DB")];

  it("子串过滤、大小写不敏感、去首尾空白", () => {
    expect(filterHistory(items, "  UPGRADE ").map((i) => i.sessionId)).toEqual(["a", "c"]);
  });

  it("空查询 = 全量；无匹配 = 空表", () => {
    expect(filterHistory(items, "   ").map((i) => i.sessionId)).toEqual(["a", "b", "c"]);
    expect(filterHistory(items, "zzz")).toEqual([]);
  });
});

describe("groupAndSort", () => {
  it("置顶恒成第一段，并从头别轴分组里摘掉（不重复出现）", () => {
    const items = [
      item("p1", "钉住的", { pinned: true, updatedAt: NOW - 3 * DAY }),
      item("t1", "今天的", { updatedAt: NOW - HOUR }),
      // 19 小时前落在**前一个日历日**——bucketLabel 只在 24h 内按日期号分今天/昨天
      // （与侧栏同一口径），所以"昨天"要用这个边界而不是"30 小时前"（那是上周）。
      item("y1", "昨天的", { updatedAt: NOW - 19 * HOUR }),
    ];
    const sections = groupAndSort(items, { group: "date", sort: "updated", lang: "zh", t });
    expect(sections.map((s) => s.title)).toEqual(["置顶", "今天", "昨天"]);
    expect(sections[0]?.items.map((i) => i.sessionId)).toEqual(["p1"]);
    expect(sections.flatMap((s) => s.items)).toHaveLength(3);
  });

  it("日期分组的段序 = 段内最新一条降序", () => {
    const items = [
      item("m1", "上月", { updatedAt: NOW - 40 * DAY }),
      item("t1", "今天", { updatedAt: NOW - HOUR }),
      item("w1", "上周", { updatedAt: NOW - 3 * DAY }),
    ];
    const sections = groupAndSort(items, { group: "date", sort: "updated", lang: "zh", t });
    expect(sections.map((s) => s.title)).toEqual(["今天", "上周", "9 月"]);
  });

  it("状态分组固定序 运行中 → 未读 → 已完成", () => {
    const items = [
      item("d1", "完成的"),
      item("u1", "未读的", { unread: true }),
      item("r1", "在跑的", { running: true }),
    ];
    const sections = groupAndSort(items, { group: "status", sort: "updated", lang: "zh", t });
    expect(sections.map((s) => s.title)).toEqual(["运行中", "未读", "已完成"]);
  });

  it("智能体分组：默认（无预设）在最前，其余按名字升序", () => {
    const items = [
      item("b1", "B", { agentPreset: "beta" }),
      item("a1", "A", { agentPreset: "alpha" }),
      item("d1", "默认的", { agentPreset: undefined }),
    ];
    const sections = groupAndSort(items, { group: "agent", sort: "updated", lang: "zh", t });
    expect(sections.map((s) => s.title)).toEqual(["默认", "alpha", "beta"]);
  });

  it("不分组：单一无标题段，段内按所选排序（标题升序）", () => {
    const items = [item("b", "banana"), item("a", "Apple"), item("c", "cherry")];
    const sections = groupAndSort(items, { group: "none", sort: "title", lang: "zh", t });
    expect(sections).toHaveLength(1);
    expect(sections[0]?.title).toBeNull();
    expect(sections[0]?.items.map((i) => i.title)).toEqual(["Apple", "banana", "cherry"]);
  });

  it("空输入不出段", () => {
    expect(groupAndSort([], { group: "date", sort: "updated", lang: "zh", t })).toEqual([]);
    expect(groupAndSort([item("p", "钉的", { pinned: true })], { group: "date", sort: "updated", lang: "zh", t }))
      .toHaveLength(1);
  });
});
