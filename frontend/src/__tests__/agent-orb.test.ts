// AgentOrb 配色的纯函数门：哈希确定性、约束带（S/L/偏移锁定）、边缘渐隐到全透明、
// 撞色是例外不是常态。输入全是固定 seed——函数是纯的，跑多少遍结果都一样。
import { describe, expect, it } from "vitest";
import { orbColors, orbHash } from "../components/AgentOrb";

const HSL_RE = /^hsl\((\d+) (\d+)% (\d+)%(?: \/ (\d+)%)?\)$/;

function hslOf(color: string): { hue: number; sat: number; lightness: number; alpha: number } {
  const m = HSL_RE.exec(color);
  expect(m, color).toBeTruthy();
  return {
    hue: Number(m![1]),
    sat: Number(m![2]),
    lightness: Number(m![3]),
    alpha: m![4] === undefined ? 100 : Number(m![4]),
  };
}

describe("orbHash：boring-avatars 同款 32 位 DJB2", () => {
  it("已知向量钉住算法；同一 seed 恒等", () => {
    expect(orbHash("abc")).toBe(96354);
    expect(orbHash("sess-42")).toBe(1984928249);
    expect(orbHash("sess-42")).toBe(orbHash("sess-42"));
  });
});

describe("orbColors：约束随机（hue 全轮，S/L 锁带，边缘渐隐）", () => {
  it("同一 seed 永远同一颗", () => {
    expect(orbColors("sess-42")).toEqual(orbColors("sess-42"));
  });

  it("已知向量：sess-42 → hue 209 / sat 58 / 偏移 74（边缘 hue 283）", () => {
    expect(orbColors("sess-42")).toEqual({
      core: "hsl(209 58% 66%)",
      mid: "hsl(283 58% 58%)",
      fade: "hsl(283 58% 56% / 55%)",
      edge: "hsl(283 58% 54% / 0%)",
    });
  });

  it("低饱和带：S 全在 45–58（A 级工具口径，不出高饱和）", () => {
    for (let i = 0; i < 60; i++) {
      const c = orbColors(`sess-${i}`);
      for (const stop of [c.core, c.mid, c.fade, c.edge]) {
        expect(hslOf(stop).sat).toBeGreaterThanOrEqual(45);
        expect(hslOf(stop).sat).toBeLessThanOrEqual(58);
      }
    }
  });

  it("亮度锁带：核心 66 / 中段 58 / 渐隐 56 / 边缘 54", () => {
    for (let i = 0; i < 60; i++) {
      const c = orbColors(`sess-${i}`);
      expect(hslOf(c.core).lightness).toBe(66);
      expect(hslOf(c.mid).lightness).toBe(58);
      expect(hslOf(c.fade).lightness).toBe(56);
      expect(hslOf(c.edge).lightness).toBe(54);
    }
  });

  it("边缘渐隐：核心与中段不透明，渐隐 55%、边缘 alpha 0（融进背景）", () => {
    for (let i = 0; i < 60; i++) {
      const c = orbColors(`sess-${i}`);
      expect(hslOf(c.core).alpha).toBe(100);
      expect(hslOf(c.mid).alpha).toBe(100);
      expect(hslOf(c.fade).alpha).toBe(55);
      expect(hslOf(c.edge).alpha).toBe(0);
    }
  });

  it("色相偏移带：中段相对核心偏移 40–89°，不回卷出界", () => {
    for (let i = 0; i < 60; i++) {
      const { core, mid } = orbColors(`sess-${i}`);
      const hue = hslOf(core).hue;
      const midHue = hslOf(mid).hue;
      const shift = (midHue - hue + 360) % 360;
      expect(shift).toBeGreaterThanOrEqual(40);
      expect(shift).toBeLessThan(90);
    }
  });

  it("不同 seed 走出不同的颜色（40 个固定 seed 全不同）", () => {
    const mids = Array.from({ length: 40 }, (_, i) => orbColors(`sess-${i}`).mid);
    expect(new Set(mids).size).toBe(40);
  });
});
