// 访问策略编辑器的行为：整份发回（插件要求 direct/group 齐全、键精确）、
// 白名单与开放两种模式的字段切换、读不到策略时整块不渲染。
// 端点参数名另有 im-snapshot 的收窄测试与实现里的注释钉住。
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  api: { im: { setBotAccessPolicy: vi.fn(async () => ({ kind: "policy" })) } },
}));
vi.mock("../i18n", () => ({
  useT: () => ({ t: (s: string) => s, tt: (zh: string) => zh, lang: "zh" }),
}));

import { api } from "../api";
import { BotAccessPolicy } from "../bots/BotAccessPolicy";
import type { ImAccessPolicy, ImBot } from "../api";

const scope = (mode: "open" | "allowlist", users: Array<{ id: string; canExecuteCommands: boolean }> = []) => ({
  mode,
  open: { defaultCanExecuteCommands: false, commandPermissionOverrides: [] },
  allowlist: { users },
});

const POLICY: ImAccessPolicy = { direct: scope("allowlist", [{ id: "wx-1", canExecuteCommands: true }]), group: scope("open") };

const BOT = (accessPolicy: ImAccessPolicy | null): ImBot => ({
  botId: "b1", state: "connected", connected: true, configured: true, workspace: "",
  model: null, agentPreset: "", accessPolicy,
  bot: { name: "机器人", accountIdMasked: "" }, health: { status: "", summary: "" },
});

function mount(accessPolicy: ImAccessPolicy | null) {
  const onSaved = vi.fn();
  const onError = vi.fn();
  render(<BotAccessPolicy channel="weixin" bot={BOT(accessPolicy)} onSaved={onSaved} onError={onError} />);
  return { onSaved, onError };
}

describe("BotAccessPolicy", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("读不到策略时整块不渲染（不摆默认值说谎）", () => {
    const { container } = render(<BotAccessPolicy channel="weixin" bot={BOT(null)} onSaved={vi.fn()} onError={vi.fn()} />);
    expect(container.textContent).toBe("");
  });

  it("白名单模式列出用户；开放模式给默认命令权限与例外清单", () => {
    mount(POLICY);
    expect(screen.getAllByText("访问策略")).toHaveLength(1);
    expect(screen.getByText("wx-1")).toBeTruthy();          // 私聊是白名单，列出用户
    expect(screen.getAllByText("默认命令权限")).toHaveLength(1); // 群聊是开放，给默认开关
    expect(screen.getByText("命令权限例外")).toBeTruthy();
  });

  it("加白名单用户：整份策略发回且只动 direct", async () => {
    const { onSaved } = mount(POLICY);
    const input = screen.getAllByPlaceholderText("用户标识（对方的 id）")[0]; // 第一块 = 私聊
    fireEvent.change(input, { target: { value: "wx-2" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(api.im.setBotAccessPolicy).toHaveBeenCalledTimes(1));
    const [channel, botId, policy] = (api.im.setBotAccessPolicy as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(channel).toBe("weixin");
    expect(botId).toBe("b1");
    // 整份发回：group 原样带着（插件要求两边齐全）
    expect(policy.group).toEqual(scope("open"));
    expect(policy.direct.allowlist.users).toEqual([
      { id: "wx-1", canExecuteCommands: true },
      { id: "wx-2", canExecuteCommands: false },
    ]);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ kind: "policy" }));
  });

  it("重复 id 不发请求（插件会拒，先在本地挡）", async () => {
    mount(POLICY);
    const input = screen.getAllByPlaceholderText("用户标识（对方的 id）")[0]; // 第一块 = 私聊
    fireEvent.change(input, { target: { value: "wx-1" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(api.im.setBotAccessPolicy).not.toHaveBeenCalled();
  });

  it("切模式：只改该场景的 mode，其余原样", async () => {
    mount(POLICY);
    // 私聊那块的下拉当前是「仅白名单用户」→ 选「所有用户」
    fireEvent.click(screen.getAllByText("仅白名单用户")[0]);
    await waitFor(() => expect(screen.getAllByText("所有用户").length).toBeGreaterThan(1));
    fireEvent.click(screen.getAllByText("所有用户").at(-1)!);

    await waitFor(() => expect(api.im.setBotAccessPolicy).toHaveBeenCalledTimes(1));
    const policy = (api.im.setBotAccessPolicy as unknown as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(policy.direct.mode).toBe("open");
    expect(policy.direct.allowlist.users).toEqual([{ id: "wx-1", canExecuteCommands: true }]); // 不清空原白名单
    expect(policy.group).toEqual(scope("open"));
  });
});
