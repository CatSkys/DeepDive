// ui 围栏（rich/ui/）的契约钉子：流式容错解析 + 词表校验。
// 流式语义是产品行为（"边生成边渲染"、未闭合 ≠ 失败），回归在这里拦。
import { describe, expect, it } from "vitest";
import { parseUiFence } from "../rich/ui/parse";
import { componentOf } from "../rich/ui/types";

const card = JSON.stringify({ type: "card", title: "方案", text: "说明", actions: [{ label: "去办", send: "请把方案 A 落地" }] });
const stat = JSON.stringify({ type: "stat", label: "成本", value: 42 });

describe("parseUiFence 流式语义", () => {
  it("未闭合且什么都没长出来：pending，不算失败", () => {
    expect(parseUiFence("", true)).toEqual({ items: [], pending: true, invalid: false });
    expect(parseUiFence("[", true)).toEqual({ items: [], pending: true, invalid: false });
    expect(parseUiFence('[{"type":"card"', true)).toEqual({ items: [], pending: true, invalid: false });
    expect(parseUiFence("等我一会儿", true)).toEqual({ items: [], pending: true, invalid: false });
  });

  it("未闭合：已闭合项逐个渲染，最后一项合规就提前上屏，不合规只挂占位", () => {
    const r = parseUiFence(`[${card},`, true);
    expect(r.invalid).toBe(false);
    expect(r.pending).toBe(true);
    expect(r.items).toHaveLength(1);
    // 最后一项半截：不渲染也不判死
    expect(parseUiFence(`[${card}, {"type":"sta`, true).items).toHaveLength(1);
    // 最后一项已闭合且合规：提前上屏（尾项暂定态渲染）
    const tail = parseUiFence(`[${card}, ${stat}]`, true);
    expect(tail.items).toHaveLength(2);
  });

  it("闭合后严格：任一项坏、数组没闭、尾部残渣 → 整块 invalid", () => {
    expect(parseUiFence(`[${card}, {"type":"nope"}]`, false).invalid).toBe(true);
    expect(parseUiFence(`[${card}, {"type":"card",`, false).invalid).toBe(true);
    expect(parseUiFence(`[${card}] 剩点话`, false).invalid).toBe(true);
    expect(parseUiFence(`[${card}`, false).invalid).toBe(true);
    expect(parseUiFence("完全是别的东西", false).invalid).toBe(true);
  });

  it("形状不符的闭合项也判 invalid（整块退回源码，不吞内容）", () => {
    // actions 缺 buttons、stat 缺 label：componentOf 拒收
    expect(parseUiFence('[{"type":"actions"}]', false).invalid).toBe(true);
    expect(parseUiFence('[{"type":"stat","value":"1"}]', false).invalid).toBe(true);
  });

  it("闭合的空数组与正常数组", () => {
    expect(parseUiFence("[]", false)).toEqual({ items: [], pending: false, invalid: false });
    expect(parseUiFence(`[${card}, ${stat}]`, false).items).toHaveLength(2);
  });
});

describe("componentOf 词表校验", () => {
  it("合规项通过且字段收窄", () => {
    const c = componentOf(JSON.parse(card));
    expect(c).not.toBeNull();
    expect(c!.type).toBe("card");
    expect(componentOf(JSON.parse(stat))).toMatchObject({ type: "stat", value: "42" });
  });

  it("超限与坏类型拒收", () => {
    expect(componentOf({ type: "card", title: "x".repeat(201) })).toBeNull();
    expect(componentOf({ type: "actions", buttons: [] })).toBeNull();
    expect(componentOf({ type: "actions", buttons: [{ label: "x", send: "y" }] })).not.toBeNull();
    expect(componentOf({ type: "form", fields: [{ name: "1bad", label: "数量", type: "text" }], submit: { label: "go", send: "s" } })).toBeNull();
    expect(componentOf({ type: "form", fields: [{ name: "qty", label: "数量", type: "select" }], submit: { label: "go", send: "s" } })).toBeNull();
    expect(componentOf({ type: "chart", chart: "bar", labels: ["a"], series: [{ values: [1, 2] }] })).toBeNull();
    expect(componentOf({ type: "chart", chart: "bar", labels: ["a", "b"], series: [{ values: [1, -2.5] }] })).not.toBeNull();
    expect(componentOf({ type: "steps", items: [{ title: "一" }], active: 5 })).toBeNull();
    expect(componentOf("a string")).toBeNull();
  });
});
