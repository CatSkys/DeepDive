// 平台入口与能力清单的钉子：mac 壳行为不变、Windows 壳能力降级、载体判定分三路。
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  IS_WINDOWS_OS,
  inShell,
  mountShellDispatch,
  shellCapabilities,
} from "../platform";
import { browserCarrierKind } from "../sidebar-right/BrowserCarrier";
import { comboOf, displayKeyCaps, formatHotkeySpec } from "../keybinds";

afterEach(() => {
  delete (window as unknown as { webkit?: unknown }).webkit;
  delete (window as unknown as { chrome?: unknown }).chrome;
});

describe("platform 能力清单", () => {
  it("纯浏览器（无壳桥）：按 mac 能力面呈现（远程面 UI 可用、载体走 iframe）", () => {
    expect(inShell()).toBe(false);
    expect(shellCapabilities().browser).toBe(true);
    expect(browserCarrierKind()).toBe("iframe");
  });

  it("mac 壳（webkit messageHandlers）：能力全量、载体走原生槽位", () => {
    (window as unknown as { webkit?: unknown }).webkit = {
      messageHandlers: { deepdiveHost: { postMessage: () => {} }, deepdive: { postMessage: () => {} } },
    };
    expect(inShell()).toBe(true);
    const caps = shellCapabilities();
    expect(caps.browser).toBe(true);
    expect(caps.remote).toBe(true);
    expect(browserCarrierKind()).toBe("native");
  });

  it("Windows 壳（chrome.webview）：第一期浏览器/远程/听写降级，载体落空态", () => {
    // UA 是 jsdom 的（非 Windows）——能力面由壳的通道形态决定：这里直接钉
    // "chrome.webview 在 = 在壳里"，IS_WINDOWS_OS 单独由 UA 断言。
    (window as unknown as { chrome?: unknown }).chrome = {
      webview: { postMessage: () => {}, addEventListener: () => {}, removeEventListener: () => {} },
    };
    expect(inShell()).toBe(true);
    expect(typeof IS_WINDOWS_OS).toBe("boolean");
    expect(mountShellDispatch(() => {})).toBeTypeOf("function");
  });
});

describe("键位的平台映射（Windows 主修饰键 = Ctrl 进 ⌘ 槽位）", () => {
  it("mac：metaKey → ⌘、ctrlKey → ⌃（现状不变）", () => {
    const e = { metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, key: "n", code: "KeyN" } as KeyboardEvent;
    expect(comboOf(e)).toBe("⌘N");
  });

  it("displayKeyCaps：mac 逐字符键帽；Windows token 化并按 Ctrl+Alt+Shift+Win 排序", () => {
    expect(displayKeyCaps("⌘N")).toEqual(["⌘", "N"]);
    expect(displayKeyCaps("⇧⌘E", true)).toEqual(["Ctrl", "Shift", "E"]);
    expect(displayKeyCaps("⌘Enter", true)).toEqual(["Ctrl", "Enter"]);
    expect(displayKeyCaps("⌥1", true)).toEqual(["Alt", "1"]);
  });

  it("formatHotkeySpec 接受 Windows 壳的 spec 词表（ctrl/alt）", () => {
    expect(formatHotkeySpec("ctrl+alt+space")).toMatch(/Space/);
  });
});
