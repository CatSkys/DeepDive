// 会话协作分区的渲染规格：投递到别的会话会按引擎契约发 session/prompt；外部 agent 的
// 联系人校验/持久化/运行链路走壳（bridgeRequest）；没有壳桥时如实降级。
// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prompt, runAgent } = vi.hoisted(() => ({ prompt: vi.fn(), runAgent: vi.fn() }));
const sessions = [
  { sessionId: "s-1", updatedAt: 200, running: false, blank: false, cwd: "/repo/a", projections: { asOfSeq: 1, values: { title: "甲会话" } } },
  { sessionId: "s-2", updatedAt: 100, running: false, blank: true, cwd: "/repo/b" },
];
vi.mock("../api", () => ({ api: { prompt } }));
vi.mock("../host", () => ({ runAgent, inShell: () => false, revealPath: vi.fn(), restartEngine: vi.fn() }));
vi.mock("../store", () => ({ useStore: () => ({ sessions, workspaces: [] }) }));
// i18n 的 useT 走 store（这里没有 provider），且**必须返回稳定引用**：真实现按语言缓存
// 闭包（i18n.ts 的 tFuncCache，注释里写明"放依赖不引发每渲染重跑"），mock 若不稳，
// 组件里 useCallback([t]) 的 effect 会每渲染重跑，测出假问题。
const tFunc = vi.hoisted(() => ({
  lang: "zh" as const,
  t: (s: string) => s,
  tt: (zh: string, _en: string, vars?: Record<string, string | number>) => {
    let out = zh;
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
    return out;
  },
}));
vi.mock("../i18n", () => ({ useT: () => tFunc }));

import { CollabSection } from "../collab/CollabSection";

// jsdom 在无 origin 的环境里可能不给 localStorage；本文件自己补一个够用的实现，
// 好让"联系人入库"这条断言真的跑起来（组件侧本来就有 try/catch 降级）。
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
});

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("会话协作分区", () => {
  it("投递消息给选中的会话：按 session/prompt 的契约发（queue 模式、文本部件）", async () => {
    prompt.mockResolvedValue({ accepted: true });
    const { getByPlaceholderText, getByText, container } = render(<CollabSection />);
    fireEvent.change(getByPlaceholderText("要投递的消息…"), { target: { value: "帮我看下这个" } });
    getByText("投递").click();
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    const payload = prompt.mock.calls[0]![0] as { sessionId: string; mode: string; content: Array<{ type: string; text: string }>; requestId: string };
    expect(payload.sessionId).toBe("s-1");        // 最近活动的会话（按 updatedAt 降序的第一个）
    expect(payload.mode).toBe("queue");
    expect(payload.content).toEqual([{ type: "text", text: "帮我看下这个" }]);
    expect(payload.requestId.length).toBeGreaterThan(0);
    await waitFor(() => expect(container.textContent).toContain("已投递"));
  });

  it("引擎拒绝时把错误原文显示出来（不静默失败）", async () => {
    prompt.mockRejectedValue(new Error('session/not-found: session "x" not found'));
    const { getByPlaceholderText, getByText, container } = render(<CollabSection />);
    fireEvent.change(getByPlaceholderText("要投递的消息…"), { target: { value: "hi" } });
    getByText("投递").click();
    await waitFor(() => expect(container.textContent).toContain("session/not-found"));
  });

  it("外部 agent 联系人：填表入库、运行走 argv 拼装（消息追加在最后）", async () => {
    runAgent.mockResolvedValue({ ok: true, output: "agent 说话" });
    const { getByPlaceholderText, getByText, container } = render(<CollabSection />);
    fireEvent.change(getByPlaceholderText("名称"), { target: { value: "Claude Code" } });
    fireEvent.change(getByPlaceholderText("命令或绝对路径"), { target: { value: "claude" } });
    fireEvent.change(getByPlaceholderText("固定参数"), { target: { value: "-p" } });
    getByText("添加").click();
    await waitFor(() => expect(container.textContent).toContain("Claude Code"));

    fireEvent.change(getByPlaceholderText("给联系人说的话…"), { target: { value: "看看仓库" } });
    getByText("运行").click();
    await waitFor(() => expect(runAgent).toHaveBeenCalledWith("claude", ["-p", "看看仓库"], 120));
    await waitFor(() => expect(container.textContent).toContain("agent 说话"));
    // 联系人落 localStorage（下次打开还在）
    expect(localStorage.getItem("deepdive.collabAgents")).toContain("Claude Code");
  });

  it("没有壳桥时运行结果回 no-shell，页面照旧可用（不崩）", async () => {
    runAgent.mockResolvedValue({ ok: false, output: "", error: "no-shell" });
    const { getByPlaceholderText, getByText, container } = render(<CollabSection />);
    fireEvent.change(getByPlaceholderText("给联系人说的话…"), { target: { value: "x" } });
    fireEvent.change(getByPlaceholderText("名称"), { target: { value: "c" } });
    fireEvent.change(getByPlaceholderText("命令或绝对路径"), { target: { value: "claude" } });
    getByText("添加").click();
    await waitFor(() => expect(container.textContent).toContain("c"));
    getByText("运行").click();
    await waitFor(() => expect(container.textContent).toContain("no-shell"));
  });
});
