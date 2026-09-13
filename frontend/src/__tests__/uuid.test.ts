// uuid 的非安全上下文回退：手机经局域网 http://<ip>:<port> 打开时
// crypto.randomUUID 是 undefined，回退必须仍产出 v4 形状的 id——否则
// SPA 挂载即崩、整页白屏（本轮实测到的事故）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { uuid } from "../uuid";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuid", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("有 randomUUID 时直接用（安全上下文）", () => {
    const spy = vi.fn(() => "11111111-2222-4333-8444-555555555555");
    vi.stubGlobal("crypto", { randomUUID: spy });
    expect(uuid()).toBe("11111111-2222-4333-8444-555555555555");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("没有 randomUUID 时回退 getRandomValues，形状仍是 v4", () => {
    // 模拟局域网 http：只有 getRandomValues
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array) => {
        for (let i = 0; i < array.length; i++) array[i] = i * 7 + 1;
        return array;
      },
    });
    expect(uuid()).toMatch(V4);
  });

  it("回退路径每次取新随机数（不重复）", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => real.getRandomValues(a) });
    const ids = new Set(Array.from({ length: 50 }, () => uuid()));
    expect(ids.size).toBe(50);
  });
});
