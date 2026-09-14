// 机器人细项编辑器的行为（渲染层）：四个控件按目录有无渲染、文字项**改过才提交**、
// 提交时打的是哪个端点与参数。没有真机器人也能验——这层是纯前端契约，
// 端点参数名另有 im-snapshot/契约测试钉住。
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  api: {
    im: {
      setBotAlias: vi.fn(async () => ({ kind: "alias" })),
      setBotWorkspace: vi.fn(async () => ({ kind: "workspace" })),
      setBotModel: vi.fn(async () => ({ kind: "model" })),
      setBotPreset: vi.fn(async () => ({ kind: "preset" })),
    },
  },
}));

// 字典只做透传：这一层测的是控件与提交行为，不是文案；也免去装 store 上下文
vi.mock("../i18n", () => ({
  useT: () => ({ t: (s: string) => s, tt: (zh: string) => zh, lang: "zh" }),
}));

import { api } from "../api";
import { BotSettings } from "../bots/BotSettings";
import type { ImBot } from "../api";

const BOT: ImBot = {
  botId: "b1",
  state: "connected",
  connected: true,
  configured: true,
  workspace: "/Users/me/proj",
  model: { provider: "deepseek-official", model: "deepseek-flash" },
  agentPreset: "standard",
  bot: { name: "我的微信", accountIdMasked: "wx***" },
  health: { status: "healthy", summary: "" },
};

const MODELS = [
  { provider: "deepseek-official", model: "deepseek-flash", label: "DeepSeek-V4-Flash" },
  { provider: "zai-coding-cn", model: "glm-4.6", label: "GLM-4.6" },
];
const PRESETS = [{ id: "standard", label: "标准模式" }, { id: "ptc", label: "PTC 模式" }];

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

function mount(overrides: Partial<Parameters<typeof BotSettings>[0]> = {}) {
  const onSaved = vi.fn();
  const onError = vi.fn();
  render(
    <BotSettings channel="weixin" bot={BOT} models={MODELS} presets={PRESETS}
      onSaved={onSaved} onError={onError} {...overrides} />,
  );
  return { onSaved, onError };
}

describe("BotSettings", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("四项都渲染，且带出当前值", () => {
    mount();
    expect(screen.getByDisplayValue("我的微信")).toBeTruthy();
    expect(screen.getByDisplayValue("/Users/me/proj")).toBeTruthy();
    expect(screen.getByText("模型")).toBeTruthy();
    expect(screen.getByText("Agent 预设")).toBeTruthy();
    expect(screen.getByText("DeepSeek-V4-Flash")).toBeTruthy();   // 模型下拉的当前值
    expect(screen.getByText("标准模式")).toBeTruthy();             // 预设下拉的当前值
  });

  it("别名改过才提交，提交后把新快照交回调用方", async () => {
    const { onSaved } = mount();
    const input = screen.getByDisplayValue("我的微信");

    fireEvent.blur(input); // 没改 → 不发
    expect(api.im.setBotAlias).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "  工作号  " } });
    fireEvent.blur(input);
    await waitFor(() => expect(api.im.setBotAlias).toHaveBeenCalledWith("weixin", "b1", "工作号"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ kind: "alias" }));
  });

  it("工作区改过才提交；改成空串也发（清空 = 回落引擎默认）", async () => {
    mount();
    const input = screen.getByDisplayValue("/Users/me/proj");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    await waitFor(() => expect(api.im.setBotWorkspace).toHaveBeenCalledWith("weixin", "b1", ""));
  });

  it("目录为空时不摆空下拉（点不动的控件不如不摆）", () => {
    mount({ models: [], presets: [] });
    expect(screen.queryByText("模型")).toBeNull();
    expect(screen.queryByText("Agent 预设")).toBeNull();
    expect(screen.getByText("别名")).toBeTruthy(); // 文字项不受影响
  });

  it("保存失败走 onError，不吞", async () => {
    asMock(api.im.setBotAlias).mockRejectedValueOnce(new Error("rpc: nope"));
    const { onSaved, onError } = mount();
    const input = screen.getByDisplayValue("我的微信");
    fireEvent.change(input, { target: { value: "换个名" } });
    fireEvent.blur(input);
    await waitFor(() => expect(onError).toHaveBeenCalledWith("rpc: nope"));
    expect(onSaved).not.toHaveBeenCalled();
  });
});
