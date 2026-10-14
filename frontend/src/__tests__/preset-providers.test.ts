import { describe, expect, it } from "vitest";
import { PRESET_PROVIDERS, presetProviderOf, presetRouteDraft, splitByRoute } from "../settings/presetProviders";

// 预置提供方（settings/presetProviders.ts）：引擎侧一条路由只挂一个协议，所以
// 「一个端点、多套协议」在这里靠"一次保存建多条路由"落地——分流规则与卡片键到路由的
// 映射是这套东西的载荷，钉住它们。
//
// 规则的事实来源：厂商文档（Claude 模型只在 /v1/messages 上回答）＋厂商自己的模型清单
// 端点实测（2026-10-14 `api.commandcode.ai/provider/v1/models`：89 条中 11 条 claude-*
// 只报 /messages，其余全带 /chat/completions）。清单变了的信号 = 这里的分流不再覆盖
// 全部模型，见最后一条测试。

const COMMANDCODE = PRESET_PROVIDERS[0];

describe("预置提供方表", () => {
  it("卡片键能反查到表项，表外（引擎目录内置/自定义）返回 undefined", () => {
    expect(presetProviderOf("commandcode")).toBe(COMMANDCODE);
    expect(presetProviderOf("deepseek-official")).toBeUndefined();
    expect(presetProviderOf("__custom__")).toBeUndefined();
  });

  it("每条路由都能按路由 id 反查到自己的端点与协议（探测按路由问端点）", () => {
    expect(presetRouteDraft("commandcode")).toEqual({
      baseURL: "https://api.commandcode.ai/provider/v1",
      api: "openai-completions",
    });
    expect(presetRouteDraft("commandcode-anthropic")).toEqual({
      baseURL: "https://api.commandcode.ai/provider/v1",
      api: "anthropic-messages",
    });
    expect(presetRouteDraft("acme-gateway")).toBeUndefined();
  });

  it("分流：claude-* 归 Anthropic 路由，其余归 OpenAI 路由", () => {
    const models = [
      { id: "claude-opus-5-5" },
      { id: "deepseek/deepseek-v4.1-flash" },
      { id: "claude-sonnet-4-6" },
      { id: "zai-org/GLM-5.2" },
    ];
    const buckets = splitByRoute(COMMANDCODE, models);
    expect(buckets.map((b) => b.route.id)).toEqual(["commandcode", "commandcode-anthropic"]);
    expect(buckets[0].models.map((m) => m.id)).toEqual(["deepseek/deepseek-v4.1-flash", "zai-org/GLM-5.2"]);
    expect(buckets[1].models.map((m) => m.id)).toEqual(["claude-opus-5-5", "claude-sonnet-4-6"]);
  });

  it("空段不出现（不建一条没有模型的路由）", () => {
    const onlyOpen = splitByRoute(COMMANDCODE, [{ id: "gpt-5.5" }]);
    expect(onlyOpen.map((b) => b.route.id)).toEqual(["commandcode"]);
    const onlyClaude = splitByRoute(COMMANDCODE, [{ id: "claude-opus-5" }]);
    expect(onlyClaude.map((b) => b.route.id)).toEqual(["commandcode-anthropic"]);
    expect(splitByRoute(COMMANDCODE, [])).toEqual([]);
  });

  it("谓词互斥且穷尽：任何一条模型恰好归一条路由", () => {
    const ids = ["claude-opus-5", "claude", "gpt-6-sol", "xiaomi/mimo-v2.6-pro", "claude-opus-4-8"];
    for (const id of ids) {
      expect(COMMANDCODE.routes.filter((r) => r.takes(id))).toHaveLength(1);
    }
  });

  it("路由 id 合法且互不相同（引擎拒收数字开头/含下划线的路由键）", () => {
    const ids = COMMANDCODE.routes.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/);
    expect(COMMANDCODE.id).toBe(COMMANDCODE.routes[0].id);
  });
});
