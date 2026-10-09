// 键位注册表：显示串规范化、不可绑的组合判定、旧值的归一。
// 这三条都是「改了没反应」的来源，所以在这里钉住。
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  bindRejection,
  comboFor,
  comboOf,
  formatHotkeySpec,
  KEYBIND_DEFS,
  parseKeybinds,
  RESERVED_COMBOS,
} from "../keybinds";

/** 造一个 KeyboardEvent：只填判据用得到的字段。 */
const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ key: k, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }) as KeyboardEvent;

describe("comboOf 显示串", () => {
  it("修饰序固定 ⌃⌥⇧⌘ + 主键", () => {
    expect(comboOf(key("k", { metaKey: true }))).toBe("⌘K");
    expect(comboOf(key("b", { metaKey: true }))).toBe("⌘B");
    expect(comboOf(key("e", { metaKey: true, shiftKey: true }))).toBe("⇧⌘E");
    expect(comboOf(key(",", { metaKey: true }))).toBe("⌘,");
    expect(comboOf(key(" ", { altKey: true }))).toBe("⌥Space");
    expect(comboOf(key("ArrowUp"))).toBe("↑");
  });

  it("Ctrl 就是 ⌃，不折算成 ⌘——按 Ctrl+K 不该记成「⌃⌘K」", () => {
    expect(comboOf(key("k", { ctrlKey: true }))).toBe("⌃K");
    expect(comboOf(key("k", { ctrlKey: true, metaKey: true }))).toBe("⌃⌘K");
  });

  it("纯修饰键没有主键 → 不是键位", () => {
    expect(comboOf(key("Meta", { metaKey: true }))).toBeUndefined();
    expect(comboOf(key("Shift", { shiftKey: true }))).toBeUndefined();
  });
});

describe("bindRejection 能不能绑", () => {
  it("裸键拒绝：各交互面里它们已有固定语义，抢了就是打字/选择乱套", () => {
    expect(bindRejection("new-session", "K", undefined)?.kind).toBe("need-modifier");
    expect(bindRejection("new-session", "Enter", undefined)?.kind).toBe("need-modifier");
    expect(bindRejection("new-session", "⇧E", undefined)?.kind).toBe("need-modifier");
    // ⌥ / ⌃ 算命令修饰键（⌥1-9 就是这一档）
    expect(bindRejection("new-session", "⌥1", undefined)).toBeUndefined();
    expect(bindRejection("new-session", "⌃K", undefined)).toBeUndefined();
  });

  it("被 macOS 菜单/系统占用的组合拒绝：绑了菜单先吃，按下去不会有反应", () => {
    for (const combo of ["⌘W", "⌘Q", "⌘M", "⌘C", "⌃⌘F", "⌘Space"]) {
      expect(bindRejection("new-session", combo, undefined)?.kind, combo).toBe("reserved");
    }
  });

  it("与别的启用项撞车 → taken，且指出是哪一条（停用的那项不算）", () => {
    expect(bindRejection("new-session", "⌘K", undefined)).toMatchObject({ kind: "taken" });
    expect(bindRejection("new-session", "⌘K", undefined)?.other?.id).toBe("command-palette");
    // ⌘K 被停用后就不占位了
    expect(bindRejection("new-session", "⌘K", { "command-palette": { off: true } })).toBeUndefined();
    // 改过的键位按改后的算，旧键位让出来
    expect(bindRejection("new-session", "⌘K", { "command-palette": { combo: "⌘J" } })).toBeUndefined();
    expect(bindRejection("new-session", "⌘J", { "command-palette": { combo: "⌘J" } })?.kind).toBe("taken");
  });

  it("自己的键位不算冲突（改回原样要放行）", () => {
    expect(bindRejection("new-session", "⌘N", undefined)).toBeUndefined();
  });
});

describe("默认键位", () => {
  it("每条默认键位都不能落在保留清单里（不然开箱就是死的）", () => {
    for (const def of KEYBIND_DEFS) expect(RESERVED_COMBOS.has(def.combo), `${def.id} ${def.combo}`).toBe(false);
  });

  it("默认键位互不重复", () => {
    const combos = KEYBIND_DEFS.map((d) => d.combo);
    expect(new Set(combos).size).toBe(combos.length);
  });
});

describe("formatHotkeySpec 壳侧 spec → 键帽串", () => {
  it("修饰序与键名跟 comboOf 同一套", () => {
    expect(formatHotkeySpec("option+space")).toBe("⌥Space");
    expect(formatHotkeySpec("command+shift+e")).toBe("⇧⌘E");
    expect(formatHotkeySpec("control+k")).toBe("⌃K");
    expect(formatHotkeySpec("command+option+control+shift+1")).toBe("⌃⌥⇧⌘1");
    expect(formatHotkeySpec("command+return")).toBe("⌘↩");
  });

  it("不转换就会把 spec 原样显示在设置页（防回归）", () => {
    expect(formatHotkeySpec("option+space")).not.toContain("+");
  });

  it("全局热键占着的组合也算保留：绑上去是死键（系统级热键先吃）", () => {
    expect(bindRejection("new-session", "⌥Space", undefined, "⌥Space")?.kind).toBe("reserved");
    // 全局热键改成别的之后，⌥Space 就让出来了
    expect(bindRejection("new-session", "⌥Space", undefined, "⌃⌥P")).toBeUndefined();
  });
});

describe("parseKeybinds 旧值归一", () => {
  it("旧的「⌃⌘X」归一到「⌃X」——Ctrl 不再当 ⌘，不归一那条绑定就永远不响", () => {
    const parsed = parseKeybinds(JSON.stringify({ "new-session": { combo: "⌃⌘K" } }));
    expect(comboFor("new-session", parsed)).toBe("⌃K");
  });

  it("坏值/空值回退默认", () => {
    expect(parseKeybinds("{oops")).toEqual({});
    expect(parseKeybinds(undefined)).toEqual({});
    expect(parseKeybinds("")).toEqual({});
    expect(comboFor("new-session", parseKeybinds("{oops"))).toBe("⌘N");
  });
});
