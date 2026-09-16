// 渐变模糊面板（⌥⌘D / ?debug=fade）的开关判据规格。真机要害：macOS 在 Option
// 按下时把 e.key 合成为 Option 层字符（US 布局 ⌥D → ∂），所以判据只能看物理键码；
// 这条测试把「key 已被合成」的真实形状钉住，防止有人改回 key === "d"。
import { describe, expect, it } from "vitest";
import { isFadeDebugShortcut } from "../debug/fadeDebug";

type Ev = { metaKey: boolean; altKey: boolean; code: string; key?: string };
const ev = (o: Partial<Ev>): Ev => ({ metaKey: false, altKey: false, code: "", ...o });

describe("isFadeDebugShortcut", () => {
  it("⌥⌘ 同时按下且物理键是 D → 命中", () => {
    expect(isFadeDebugShortcut(ev({ metaKey: true, altKey: true, code: "KeyD" }))).toBe(true);
  });

  it("e.key 已被合成为 Option 层字符（∂）时依然命中", () => {
    expect(isFadeDebugShortcut(ev({ metaKey: true, altKey: true, code: "KeyD", key: "∂" }))).toBe(true);
  });

  it("缺任一修饰键 → 不命中", () => {
    expect(isFadeDebugShortcut(ev({ metaKey: true, code: "KeyD" }))).toBe(false);
    expect(isFadeDebugShortcut(ev({ altKey: true, code: "KeyD" }))).toBe(false);
  });

  it("同修饰下的别的物理键 → 不命中", () => {
    expect(isFadeDebugShortcut(ev({ metaKey: true, altKey: true, code: "KeyC" }))).toBe(false);
  });
});
