// DeepDiving store（game/store.ts）：最高深度与提示音开关的 localStorage 契约、
// 相位转换只收对应来源相位。模块级世界单例在此被测试改写，仅测相位机。
// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  bestDepth,
  currentWorld,
  pauseWorld,
  replaceWorld,
  resumeWorld,
  setSoundOn,
  soundOn,
  submitDepth,
} from "../game/store";

// jsdom（本仓没配 vitest environmentOptions）里 `localStorage` 这个裸全局不存在——
// 与 composer-overlay.test.tsx 同一份内存实现（同一把尺），别让测试去改产品代码。
beforeAll(() => {
  if (!globalThis.localStorage) {
    const map = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, String(v)); },
      removeItem: (k: string) => { map.delete(k); },
      clear: () => { map.clear(); },
      key: (i: number) => [...map.keys()][i] ?? null,
      get length() { return map.size; },
    } as unknown as Storage;
  }
});

beforeEach(() => localStorage.clear());

describe("最高深度", () => {
  it("无纪录回 0；破纪录落盘，不破不写", () => {
    expect(bestDepth()).toBe(0);
    expect(submitDepth(120.9)).toBe(true);
    expect(bestDepth()).toBe(120);
    expect(submitDepth(100)).toBe(false);
    expect(bestDepth()).toBe(120);
  });
});

describe("提示音开关", () => {
  it("默认开，可关", () => {
    expect(soundOn()).toBe(true);
    setSoundOn(false);
    expect(soundOn()).toBe(false);
  });
});

describe("相位转换", () => {
  it("pauseWorld 只收运行中，resumeWorld 只收暂停", () => {
    replaceWorld({ ...currentWorld(), phase: "dead" });
    pauseWorld();
    expect(currentWorld().phase).toBe("dead");
    resumeWorld();
    expect(currentWorld().phase).toBe("dead");
    replaceWorld({ ...currentWorld(), phase: "run" });
    pauseWorld();
    expect(currentWorld().phase).toBe("paused");
    resumeWorld();
    expect(currentWorld().phase).toBe("run");
  });
});
