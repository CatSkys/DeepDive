// 「这一页看得见什么」的引脚：主窗不显示快捷空间、也不显示它的会话（用户 2026-10-14
// 「悬浮快捷会话不在主面板中显示」）；悬浮面板那条线反过来照旧全量（面板的历史/锚点
// 全指着它）。两个方向都钉住——判据只此一处（store/pageVisibility.ts），store 的空间
// 层与会话层各问它一次。
import { describe, expect, it } from "vitest";
import { sessionsOnPage, workspacesOnPage } from "../store/pageVisibility";
import type { SessionSummary, WorkspaceView } from "../types";

const ws = (workspaceId: string, path: string): WorkspaceView => ({
  workspaceId,
  path,
  title: workspaceId,
  sessionIds: [],
  createdAt: "2026-10-14T00:00:00Z",
  updatedAt: "2026-10-14T00:00:00Z",
});

const summary = (sessionId: string): SessionSummary => ({
  sessionId,
  updatedAt: 0,
  running: false,
  blank: false,
});

const ALL = [ws("ws-quick", "/support/DeepDive/快捷会话"), ws("ws-proj", "/Users/me/proj")];
const QUICK = "ws-quick";

describe("workspacesOnPage", () => {
  it("主窗摘掉快捷空间，顺序不动（⌥N 与切换器共用同一份编号）", () => {
    expect(workspacesOnPage(ALL, QUICK, false).map((w) => w.workspaceId)).toEqual(["ws-proj"]);
  });

  it("面板页照旧全量，快捷空间仍是首位（面板的锚点）", () => {
    expect(workspacesOnPage(ALL, QUICK, true).map((w) => w.workspaceId)).toEqual(["ws-quick", "ws-proj"]);
  });

  it("壳还没下发快捷空间目录时（id 未知）两页都不动列表——不猜哪个是它", () => {
    expect(workspacesOnPage(ALL, null, false).map((w) => w.workspaceId)).toEqual(["ws-quick", "ws-proj"]);
  });
});

describe("sessionsOnPage", () => {
  const list = [summary("s-quick"), summary("s-proj"), summary("s-stray")];
  const wsOf = new Map([
    ["s-quick", QUICK],
    ["s-proj", "ws-proj"],
    ["s-stray", "ws-proj"],
  ]);

  it("主窗摘掉归在快捷空间里的会话，别的会话一条不少", () => {
    expect(sessionsOnPage(list, wsOf, QUICK, false).map((s) => s.sessionId)).toEqual(["s-proj", "s-stray"]);
  });

  it("面板页一条不摘（面板的历史就是这些）", () => {
    expect(sessionsOnPage(list, wsOf, QUICK, true).map((s) => s.sessionId)).toEqual(["s-quick", "s-proj", "s-stray"]);
  });
});
