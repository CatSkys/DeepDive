// 草稿模型持久化（draftModel.ts）：边界校验（值损坏等同无草稿）、读写
// roundtrip、hero 生效模型口径（草稿优先 / 失效跟引擎默认）。
// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { DRAFT_MODEL_KEY, heroModelFace, parseDraftModel, readDraftModel, writeDraftModel, type DraftModel } from "../draftModel";
import type { ModelOption } from "../components/ModelMenu";

// jsdom（本仓没配 vitest environmentOptions）里 `localStorage` 这个裸全局不存在
// ——补一份内存实现，别让测试去改产品代码（同 composer-overlay.test.tsx）。
beforeAll(() => {
  if (!globalThis.localStorage) {
    const map = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: (i: number) => [...map.keys()][i] ?? null,
      get length() { return map.size; },
    };
  }
});

const FLASH: ModelOption = {
  provider: "deepseek",
  model: "v4",
  label: "DeepSeek-V4",
  providerLabel: "DeepSeek",
  efforts: [{ id: "low", name: "Low" }, { id: "high", name: "High" }],
};

describe("parseDraftModel 边界校验", () => {
  it("provider/model 缺一或类型不对 → null", () => {
    expect(parseDraftModel(null)).toBeNull();
    expect(parseDraftModel("x")).toBeNull();
    expect(parseDraftModel({})).toBeNull();
    expect(parseDraftModel({ provider: "deepseek" })).toBeNull();
    expect(parseDraftModel({ model: "v4" })).toBeNull();
    expect(parseDraftModel({ provider: 1, model: "v4" })).toBeNull();
  });

  it("合法对象照收，非字符串 reasoningEffort 丢弃", () => {
    expect(parseDraftModel({ provider: "deepseek", model: "v4" })).toEqual({ provider: "deepseek", model: "v4" });
    expect(parseDraftModel({ provider: "deepseek", model: "v4", reasoningEffort: "high" }))
      .toEqual({ provider: "deepseek", model: "v4", reasoningEffort: "high" });
    expect(parseDraftModel({ provider: "deepseek", model: "v4", reasoningEffort: 3 }))
      .toEqual({ provider: "deepseek", model: "v4" });
  });
});

describe("读写 roundtrip", () => {
  it("write 后 read 原样回来；写 null 读回 null", () => {
    const dm: DraftModel = { provider: "deepseek", model: "v4", reasoningEffort: "high" };
    writeDraftModel(dm);
    expect(readDraftModel()).toEqual(dm);
    writeDraftModel(null);
    expect(readDraftModel()).toBeNull();
  });

  it("localStorage 里是坏 JSON / 坏结构 → 读档回 null", () => {
    localStorage.setItem(DRAFT_MODEL_KEY, "{not json");
    expect(readDraftModel()).toBeNull();
    localStorage.setItem(DRAFT_MODEL_KEY, JSON.stringify({ provider: 9 }));
    expect(readDraftModel()).toBeNull();
  });
});

describe("heroModelFace：hero 头部生效模型口径", () => {
  const PLAIN: ModelOption = { provider: "openai", model: "gpt", label: "GPT-4o", providerLabel: "OpenAI" };
  const models = [FLASH, PLAIN];
  const DEF = { provider: "deepseek", model: "v4" };

  it("尚无草稿 → 跟引擎默认，档位来自默认模型的 efforts（标签不靠手选才出现）", () => {
    const face = heroModelFace(models, null, DEF);
    expect(face.currentModel).toEqual(DEF);
    expect(face.efforts).toEqual(FLASH.efforts);
    expect(face.effort).toBeUndefined();
  });

  it("草稿在目录 → 草稿优先，effort 用草稿自己的档位", () => {
    const dm: DraftModel = { provider: "deepseek", model: "v4", reasoningEffort: "low" };
    const face = heroModelFace(models, dm, { provider: "openai", model: "gpt" });
    expect(face.currentModel).toEqual({ provider: "deepseek", model: "v4" });
    expect(face.effort).toBe("low");
  });

  it("草稿已不在目录（配置撤销）→ 跟引擎默认，且不带旧档位", () => {
    const dm: DraftModel = { provider: "gone", model: "x", reasoningEffort: "high" };
    const face = heroModelFace(models, dm, DEF);
    expect(face.currentModel).toEqual(DEF);
    expect(face.effort).toBeUndefined();
  });

  it("目录里没有默认模型（引擎未就绪）→ 空面，不显示档位", () => {
    const face = heroModelFace(models, null, { provider: "nope", model: "x" });
    expect(face.currentModel).toBeUndefined();
    expect(face.efforts).toEqual([]);
  });
});
