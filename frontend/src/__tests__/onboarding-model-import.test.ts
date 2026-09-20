// 迁移步的模型配置映射：这里钉的是"不猜"的边界——表内映射出路由/密钥，表外一律
// 落成"不可导入 + 原因"（绝不凭名字相似去猜提供方）。
import { describe, expect, it } from "vitest";
import { planModelImport, routeIdFromName, stripJsonComments, type PlanInput } from "../onboarding/agentModelImport";
import type { ProviderInfo } from "../settings/ModelDialog";

const PROVIDERS: ProviderInfo[] = [
  { provider: "deepseek-official", displayName: "DeepSeek", settingsNs: "llm-deepseek", active: true },
  { provider: "zai-coding-cn", displayName: "Z.ai", settingsNs: "llm-pi-ai", active: true },
];

const baseInput = (files: Record<string, string>, over: Partial<PlanInput> = {}): PlanInput => ({
  files,
  providers: PROVIDERS,
  deepseekApiKeyEnv: "DEEPSEEK_API_KEY",
  existingRoutes: [],
  protocols: ["openai-completions", "openai-responses", "anthropic-messages"],
  ...over,
});

describe("JSONC 去注释", () => {
  it("剥掉行注释与块注释，字符串里的斜杠不动", () => {
    const jsonc = '{\n  // line\n  "a": "http://x//y", /* block */ "b": 1\n}';
    expect(JSON.parse(stripJsonComments(jsonc))).toEqual({ a: "http://x//y", b: 1 });
  });
});

describe("路由 id 派生", () => {
  it("小写、非字母数字转 -、去首尾", () => {
    expect(routeIdFromName("BigModel - Coding Plan")).toBe("bigmodel-coding-plan");
    expect(routeIdFromName("Z.ai")).toBe("z-ai");
    expect(routeIdFromName("123")).toBe("123"); // 纯数字开头 → 后面按 isRouteId 拒
  });
});

describe("zcode", () => {
  const zcode = JSON.stringify({
    provider: {
      "builtin:zai-plan": {
        name: "Z.ai Plan", kind: "anthropic", options: { apiKey: "k1", baseURL: "https://api.z.ai/api/anthropic" },
        models: { "GLM-5.3": { limit: { context: 1000000, output: 128000 }, modalities: { input: ["text", "image"] } } },
      },
      "uuid-1": {
        name: "DeepSeek", kind: "anthropic", options: { apiKey: "k2", baseURL: "https://api.deepseek.com/anthropic" },
        models: { "deepseek-chat": {} },
      },
      "uuid-2": { name: "NoKey", kind: "anthropic", options: { baseURL: "https://x.example/api" }, models: {} },
      "uuid-3": { name: "Weird", kind: "grpc", options: { apiKey: "k3", baseURL: "https://y.example/api" }, models: { m: {} } },
    },
  });

  it("有端点有密钥 → 自定义路由，模型元数据跟着搬", () => {
    const plan = planModelImport(baseInput({ zcode }));
    const route = plan.items.find((i) => i.routeId === "z-ai-plan");
    expect(route).toMatchObject({ api: "anthropic-messages", baseURL: "https://api.z.ai/api/anthropic", ref: "Z_AI_PLAN_API_KEY" });
    expect(route?.models?.[0]).toMatchObject({ id: "GLM-5.3", contextWindow: 1000000, maxTokens: 128000, input: ["text", "image"] });
  });

  it("端点属内置（api.deepseek.com）→ 只导密钥，不建重复路由", () => {
    const plan = planModelImport(baseInput({ zcode }));
    const key = plan.items.find((i) => i.providerId === "deepseek-official");
    expect(key).toMatchObject({ ref: "DEEPSEEK_API_KEY", key: "k2" });
    expect(key?.routeId).toBeUndefined();
  });

  it("没有密钥 / 协议不认识 → 只出说明，不出条目（不猜）", () => {
    const plan = planModelImport(baseInput({ zcode }));
    const labels = plan.notes.map((n) => n.label);
    expect(labels).toContain("NoKey");
    expect(labels).toContain("Weird");
    expect(plan.items.some((i) => i.label === "Weird")).toBe(false);
  });

  it("引擎没暴露协议面 → 路由全拒（内置密钥仍可导）", () => {
    const plan = planModelImport(baseInput({ zcode }, { protocols: [] }));
    expect(plan.items.some((i) => i.routeId)).toBe(false);
    expect(plan.items.some((i) => i.providerId === "deepseek-official")).toBe(true);
  });
});

describe("opencode / pi / 撞名", () => {
  it("opencode 只有密钥：表内 id 归内置，表外只出说明", () => {
    const opencode = JSON.stringify({
      deepseek: { type: "api", key: "k" },
      "siliconflow-cn": { type: "api", key: "k2" },
      openai: { type: "oauth", access: "token" },
    });
    const plan = planModelImport(baseInput({ opencode }));
    expect(plan.items).toEqual([expect.objectContaining({ providerId: "deepseek-official", ref: "DEEPSEEK_API_KEY" })]);
    expect(plan.notes.map((n) => n.label).sort()).toEqual(["openai", "siliconflow-cn"]);
  });

  it("pi 的 api 就是引擎协议值 → 直接可导", () => {
    const pi = JSON.stringify({
      providers: {
        ark: { baseUrl: "https://ark.example/api/v3", api: "openai-completions", apiKey: "k", models: [{ id: "m1", name: "M1", contextWindow: 8, maxTokens: 4, input: ["text"] }] },
      },
    });
    const plan = planModelImport(baseInput({ pi }));
    expect(plan.items[0]).toMatchObject({ routeId: "ark", api: "openai-completions", ref: "ARK_API_KEY" });
  });

  it("撞名追加序号（与已存在路由/内置提供方都不冲突）", () => {
    const zcode = JSON.stringify({
      provider: { a: { name: "Ark", kind: "anthropic", options: { apiKey: "k", baseURL: "https://a.example/api" }, models: { m: {} } } },
    });
    const plan = planModelImport(baseInput({ zcode }, { existingRoutes: ["ark"] }));
    expect(plan.items[0]?.routeId).toBe("ark-2");
  });

  it("解析失败如实报，不半解析", () => {
    const plan = planModelImport(baseInput({ mimocode: "{ this is not json" }));
    expect(plan.items).toHaveLength(0);
    expect(plan.notes[0]?.reason).toContain("解析失败");
  });
});
