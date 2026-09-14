// IM 渠道快照的收窄（铁律 5）：wire 载荷按 unknown 处理，逐字段判定后落成契约
// 形状。夹具取自真机 `connection.status` 响应（@xmanrui/dsh-im 4.20.2 实测），
// 只截短目录规模，字段名与嵌套保持原样——这样插件改字段时测试会先炸。
import { describe, expect, it } from "vitest";
import { narrowImSnapshot } from "../api";

/** 真机响应（截短后）：目录里 2 个提供方 × 2 个模型 + 2 个预设。 */
const REAL = {
  schemaVersion: 1,
  revision: 0,
  state: "disconnected",
  bots: [],
  totals: { configured: 0, connected: 0 },
  agentPresetCatalog: {
    defaultId: "standard",
    items: [{ id: "standard", label: "标准模式" }, { id: "ptc", label: "PTC 模式" }],
  },
  modelCatalog: {
    groups: [
      { id: "deepseek-official", name: "DeepSeek", models: [{ id: "deepseek-flash", name: "DeepSeek-V41-Flash" }, { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" }] },
      { id: "zai-coding-cn", name: "Z.ai", models: [{ id: "glm-4.6", name: "GLM-4.6" }] },
    ],
  },
};

describe("narrowImSnapshot", () => {
  it("把模型目录摊平成可选项（提供方取组 id）", () => {
    const s = narrowImSnapshot(REAL);
    expect(s.models).toEqual([
      { provider: "deepseek-official", model: "deepseek-flash", label: "DeepSeek-V41-Flash" },
      { provider: "deepseek-official", model: "deepseek-v4-pro", label: "DeepSeek-V4-Pro" },
      { provider: "zai-coding-cn", model: "glm-4.6", label: "GLM-4.6" },
    ]);
  });

  it("预设取 items（label 缺失回落 id）", () => {
    const s = narrowImSnapshot(REAL);
    expect(s.presets).toEqual([{ id: "standard", label: "标准模式" }, { id: "ptc", label: "PTC 模式" }]);
    expect(narrowImSnapshot({ agentPresetCatalog: { items: [{ id: "x" }] } }).presets).toEqual([{ id: "x", label: "x" }]);
  });

  it("机器人字段逐项落地，模型取 provider+model", () => {
    const s = narrowImSnapshot({
      bots: [{
        botId: "b1", state: "connected", connected: true, configured: true,
        workspace: "/tmp/ws", model: { provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "high" },
        agentPreset: "standard",
        bot: { name: "我的微信", accountIdMasked: "wx***" },
        health: { status: "healthy", summary: "微信连接正常" },
      }],
    });
    expect(s.bots).toEqual([{
      botId: "b1", state: "connected", connected: true, configured: true,
      workspace: "/tmp/ws", model: { provider: "deepseek-official", model: "deepseek-flash" },
      agentPreset: "standard",
      accessPolicy: null,
      bot: { name: "我的微信", accountIdMasked: "wx***" },
      health: { status: "healthy", summary: "微信连接正常" },
    }]);
    // totals 缺失时按 bots 推（configured/connected 计数）
    expect(s.totals).toEqual({ configured: 1, connected: 1 });
  });

  it("缺 botId 的条目丢掉；模型缺 provider 或 model 时落 null", () => {
    const s = narrowImSnapshot({ bots: [{ state: "connected" }, { botId: "b2", model: { model: "only-model" } }] });
    expect(s.bots.map((b) => b.botId)).toEqual(["b2"]);
    expect(s.bots[0].model).toBeNull();
    expect(s.bots[0].bot.name).toBe("b2"); // 名字缺失回落 botId
  });

  it("目录缺失/形状不对一律降级成空表，不抛", () => {
    for (const payload of [null, undefined, 42, "x", {}, { modelCatalog: { groups: "no" } }, { agentPresetCatalog: { items: [1, 2] } }]) {
      const s = narrowImSnapshot(payload);
      expect(s.models).toEqual([]);
      expect(s.presets).toEqual([]);
      expect(s.bots).toEqual([]);
      expect(s.state).toBe("unknown");
    }
  });
});

// ── 访问策略 ──
// 形状取自插件 shared/access-policy.mjs：{direct, group} × {mode, open{...}, allowlist{users}}。
const SCOPE = (mode: "open" | "allowlist") => ({
  mode,
  open: { defaultCanExecuteCommands: false, commandPermissionOverrides: [] },
  allowlist: { users: [{ id: "wx-1", canExecuteCommands: true }] },
});

describe("narrowImSnapshot · 访问策略", () => {
  it("完整策略逐项落地（形状与 wire 一致，不做扁平化）", () => {
    const s = narrowImSnapshot({ bots: [{ botId: "b1", accessPolicy: { direct: SCOPE("allowlist"), group: SCOPE("open") } }] });
    expect(s.bots[0].accessPolicy).toEqual({ direct: SCOPE("allowlist"), group: SCOPE("open") });
  });

  it("形状不对一律落 null（UI 据此整块不渲染，不摆默认值）", () => {
    const bad = [
      undefined,
      {},
      { direct: SCOPE("allowlist") },                                   // 缺 group
      { direct: { ...SCOPE("allowlist"), mode: "everyone" }, group: SCOPE("open") },
      { direct: { ...SCOPE("open"), open: { defaultCanExecuteCommands: "yes", commandPermissionOverrides: [] } }, group: SCOPE("open") },
      { direct: { ...SCOPE("open"), allowlist: { users: [{ id: "x" }] } }, group: SCOPE("open") },
      { direct: { ...SCOPE("open"), allowlist: { users: "none" } }, group: SCOPE("open") },
    ];
    for (const accessPolicy of bad) {
      const s = narrowImSnapshot({ bots: [{ botId: "b1", accessPolicy }] });
      expect(s.bots[0].accessPolicy, JSON.stringify(accessPolicy)).toBeNull();
    }
  });
});
