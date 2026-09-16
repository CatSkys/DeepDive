// @vitest-environment jsdom
// 渐变模糊面板（⌥⌘D / ?debug=fade）的规格：开关判据只认物理键码；旋钮=真被消费的
// CSS 变量、单位成对；面板拖一根就写 :root 并存档，「恢复默认」摘掉覆盖。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FadeDebugPanel } from "../debug/FadeDebugPanel";
import {
  FADE_KNOBS, applyFadeValues, buildFadeCss, isFadeDebugShortcut, loadFadeValues, resetFadeValues, saveFadeValues,
} from "../debug/fadeDebug";

// Node 自带一个未启用的 localStorage 全局（要 --localstorage-file），jsdom 的那个
// 被它挡在外头——面板的存档是 localStorage，这里补个内存桩。
const store = new Map<string, string>();
beforeAll(() => {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  });
});

afterEach(() => {
  cleanup();
  store.clear();
  for (const { key } of FADE_KNOBS) document.documentElement.style.removeProperty(key);
});

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

describe("旋钮模型", () => {
  it("每根旋钮的键都带单位，且 px / % 各自成对", () => {
    expect(FADE_KNOBS.map((k) => [k.key, k.unit])).toEqual([
      ["--session-fade-top", "px"],
      ["--session-fade-blur", "px"],
      ["--session-header-h", "px"],
    ]);
  });

  it("buildFadeCss 按各自单位出串", () => {
    const css = buildFadeCss({
      "--session-fade-top": 72, "--session-fade-blur": 16, "--session-header-h": 59,
    });
    expect(css).toContain("--session-fade-top: 72px;");
    expect(css).toContain("--session-header-h: 59px;");
  });

  it(":root 的声明是默认值；存档只覆盖在册旋钮，不在册的旧键不带进来", () => {
    document.documentElement.style.setProperty("--session-fade-blur", "12px");
    saveFadeValues({ "--session-fade-blur": 20, "--session-fade-solid": 50 } as Record<string, number>);
    const v = loadFadeValues();
    expect(v["--session-fade-blur"]).toBe(20);
    expect(v["--session-fade-solid"]).toBeUndefined();
    // 存档损坏 → 退回 :root 值，不炸
    localStorage.setItem("deepdive.debug.fade", "{oops");
    expect(loadFadeValues()["--session-fade-blur"]).toBe(12);
  });

  it("恢复默认摘掉行内覆盖与存档", () => {
    applyFadeValues({ "--session-fade-blur": 24 });
    saveFadeValues({ "--session-fade-blur": 24 });
    resetFadeValues();
    expect(document.documentElement.style.getPropertyValue("--session-fade-blur")).toBe("");
    expect(localStorage.getItem("deepdive.debug.fade")).toBeNull();
  });
});

describe("FadeDebugPanel", () => {
  it("三根旋钮都在，拖动写 :root 并存档", () => {
    render(<FadeDebugPanel onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "渐变模糊调试" })).not.toBeNull();
    const sliders = document.querySelectorAll<HTMLInputElement>('input[type="range"]');
    expect(sliders).toHaveLength(FADE_KNOBS.length);
    fireEvent.change(sliders[1]!, { target: { value: "20" } });
    expect(document.documentElement.style.getPropertyValue("--session-fade-blur")).toBe("20px");
    expect(JSON.parse(localStorage.getItem("deepdive.debug.fade")!)["--session-fade-blur"]).toBe(20);
  });

  it("『恢复默认』把 :root 的覆盖摘掉", () => {
    applyFadeValues({ "--session-fade-top": 200 });
    render(<FadeDebugPanel onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    expect(document.documentElement.style.getPropertyValue("--session-fade-top")).toBe("");
  });
});
