import { describe, expect, it } from "vitest";
import {
  declaredInput,
  isRouteId,
  normalizeBaseURL,
  rewriteEntry,
  rewriteOverride,
  visualKeyOf,
} from "../settings/ModelDialog";
import { piProtocolsOf } from "../settings/piProtocols";

// 模型弹窗的纯函数：地址规范化、手写路由 id 约束、模型类型声明的读写，
// 以及从 settings/describe 的 schema 里取手写路由可声明的协议枚举。

describe("normalizeBaseURL", () => {
  it("补协议、去尾斜杠，保留 /v1 这类路径前缀", () => {
    expect(normalizeBaseURL("api.example.com/v1/")).toBe("https://api.example.com/v1");
    expect(normalizeBaseURL("  https://gateway.example/v1  ")).toBe("https://gateway.example/v1");
    expect(normalizeBaseURL("http://127.0.0.1:8000/v1")).toBe("http://127.0.0.1:8000/v1");
  });

  it("空串与没有主机名的地址一律拒绝", () => {
    expect(normalizeBaseURL("   ")).toBeNull();
    expect(normalizeBaseURL("https://")).toBeNull();
  });
});

describe("isRouteId", () => {
  it("小写字母开头的短横线串合法", () => {
    expect(isRouteId("acme-gateway")).toBe(true);
    expect(isRouteId("openrouter2")).toBe(true);
  });

  it("数字开头、大写、下划线、空串都不合法（凭据名会炸在引擎侧）", () => {
    for (const bad of ["", "9x", "Acme", "acme_gateway", "acme-", "-acme"]) {
      expect(isRouteId(bad)).toBe(false);
    }
  });
});

describe("模型类型声明", () => {
  it("字段名按适配器分流：pi 是 input，deepseek 是 inputModalities", () => {
    expect(visualKeyOf("deepseek-official")).toBe("inputModalities");
    expect(visualKeyOf("kimi-coding")).toBe("input");
    expect(visualKeyOf("__custom__")).toBe("input");
  });

  it("读原条目的已声明模态", () => {
    expect(declaredInput({ input: ["text", "image"] }, "input")).toEqual(["text", "image"]);
    expect(declaredInput({ input: "image" }, "input")).toEqual([]);
    expect(declaredInput(undefined, "inputModalities")).toEqual([]);
  });

  it("勾选＝声明 text+image；pi 条目用 input 拼写", () => {
    expect(rewriteEntry(undefined, "gpt-4o", "input", true)).toEqual({ id: "gpt-4o", input: ["text", "image"] });
  });

  it("取消勾选＝不声明（不是降级成纯文本）", () => {
    const next = rewriteEntry({ id: "m", input: ["text", "image"] }, "m", "input", false);
    expect(next).toEqual({ id: "m" });
  });

  it("编辑目录条目时界面不展示的字段原样带过", () => {
    const orig = { id: "m", name: "M", contextWindow: 262144, maxTokens: 32768, reasoningEfforts: { high: "high" } };
    expect(rewriteEntry(orig, "m2", "input", true)).toEqual({
      ...orig, id: "m2", input: ["text", "image"],
    });
  });

  it("deepseek 条目把模态写在 inputModalities 上", () => {
    const next = rewriteEntry({ id: "deepseek-flash", imagePixelBudget: 640000 }, "deepseek-flash", "inputModalities", true);
    expect(next).toEqual({ id: "deepseek-flash", imagePixelBudget: 640000, inputModalities: ["text", "image"] });
  });
});

describe("rewriteOverride（引擎目录行走 modelOverrides，不动 models 清单）", () => {
  it("在原 override 上补视觉声明", () => {
    expect(rewriteOverride({ input: ["text"] }, "input", true)).toEqual({ input: ["text", "image"] });
  });

  it("没有任何声明剩下时返回 null（调用方删键，不留空对象）", () => {
    expect(rewriteOverride({ input: ["text", "image"] }, "input", false)).toBeNull();
    expect(rewriteOverride(undefined, "input", false)).toBeNull();
  });

  it("取消视觉只摘掉 input，其余字段留着", () => {
    expect(rewriteOverride({ input: ["text", "image"], maxTokens: 8192 }, "input", false)).toEqual({ maxTokens: 8192 });
  });
});

describe("piProtocolsOf", () => {
  // settings/describe 里 llm-pi-ai 的 schema 载荷实测形状（schemastery compact
  // refs 编码，节点 id 换成小整数）：object.dict.providers → dict.inner →
  // object.dict.api → union.list → const.value。
  const schema = {
    uid: 1,
    refs: {
      "1": { type: "object", dict: { providers: 2 } },
      "2": { type: "dict", inner: 3 },
      "3": { type: "object", dict: { apiKeyEnv: 7, api: 4, baseURL: 8 } },
      "4": { type: "union", list: [5, 6] },
      "5": { type: "const", value: "openai-completions" },
      "6": { type: "const", value: "anthropic-messages" },
    },
  };

  it("按引擎报的顺序取出协议枚举", () => {
    expect(piProtocolsOf({ schema })).toEqual(["openai-completions", "anthropic-messages"]);
  });

  it("命名空间缺失或形状不合时返回空表（调用方据此不提供自定义入口）", () => {
    expect(piProtocolsOf(undefined)).toEqual([]);
    expect(piProtocolsOf({})).toEqual([]);
    expect(piProtocolsOf({ schema: { uid: 1, refs: {} } })).toEqual([]);
    expect(piProtocolsOf({ schema: { uid: 1, refs: { "1": { type: "object", dict: {} } } } })).toEqual([]);
  });
});
