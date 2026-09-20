import { describe, expect, it } from "vitest";
import {
  apiKeyDeclaration,
  declaredInput,
  deriveRouteFromBaseURL,
  isRouteId,
  keyRefOf,
  normalizeBaseURL,
  rewriteEntry,
  rewriteOverride,
  sessionHeaders,
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
  it("字母开头、字母数字与连字符，大小写不限", () => {
    for (const ok of ["acme-gateway", "Acme-Gateway", "ACME", "openrouter2"]) {
      expect(isRouteId(ok)).toBe(true);
    }
  });

  it("数字开头（派生出的密钥名引擎不收）、空串、多音分隔符都不合法", () => {
    for (const bad of ["", "9x", "-acme", "acme-", "acme--gw", "acme_gateway", "acme.gateway", "acme gateway"]) {
      expect(isRouteId(bad)).toBe(false);
    }
  });
});

describe("deriveRouteFromBaseURL（提供方 ID 留空时的默认名）", () => {
  it("取主机名，非字母数字折成连字符", () => {
    expect(deriveRouteFromBaseURL("https://api.example.com/v1")).toBe("api-example-com");
    expect(deriveRouteFromBaseURL("token-plan-cn.xiaomimimo.com")).toBe("token-plan-cn-xiaomimimo-com");
  });

  it("地址为空/非法时不给默认名", () => {
    expect(deriveRouteFromBaseURL("")).toBe("");
    expect(deriveRouteFromBaseURL("https://")).toBe("");
  });

  it("主机名以数字开头时不给默认名（派生的密钥名会被引擎拒）", () => {
    expect(deriveRouteFromBaseURL("http://127.0.0.1:8000/v1")).toBe("");
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

describe("apiKeyDeclaration（存了密钥就要在 profile 上声明 ref）", () => {
  it("填了密钥＝声明它落库用的那个 ref（由 keyRefOf 派生）", () => {
    const ref = keyRefOf("opencode-go", "DEEPSEEK_API_KEY");
    expect(ref).toBe("OPENCODE_GO_API_KEY");
    expect(apiKeyDeclaration("sk-abc", ref)).toEqual({ apiKeyEnv: "OPENCODE_GO_API_KEY" });
  });

  it("留空＝不作声，由调用方 `...prev` 保留 profile 里原有的声明", () => {
    expect(apiKeyDeclaration("", "OPENCODE_GO_API_KEY")).toEqual({});
    expect(apiKeyDeclaration("   ", "OPENCODE_GO_API_KEY")).toEqual({});
  });
});

describe("sessionHeaders（端点要求的路由级会话头）", () => {
  it("表里的提供方生成一个稳定 id，并在下次保存时原样带过", () => {
    const first = sessionHeaders("opencode-go", undefined);
    expect(first?.["x-opencode-session"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const second = sessionHeaders("opencode-go", first);
    expect(second?.["x-opencode-session"]).toBe(first?.["x-opencode-session"]);
  });

  it("已有的其它头原样保留", () => {
    const next = sessionHeaders("opencode", { "x-opencode-session": "keep-me", "x-other": "v" });
    expect(next).toEqual({ "x-opencode-session": "keep-me", "x-other": "v" });
  });

  it("表外的提供方不加头", () => {
    expect(sessionHeaders("deepseek-official", undefined)).toBeUndefined();
    expect(sessionHeaders("acme-gateway", undefined)).toBeUndefined();
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
