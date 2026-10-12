// AgentOrb 配色的纯函数门：哈希确定性、约束带（S/L/偏移锁定）、两团色错位对角、
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

describe("orbColors：约束随机（hue 全轮，S/L 锁带，两团色错位）", () => {
  it("同一 seed 永远同一颗", () => {
    expect(orbColors("sess-42")).toEqual(orbColors("sess-42"));
  });

  it("已知向量：sess-42 → 主团 hue 209 / 伴团 hue 278（偏移 69）", () => {
    expect(orbColors("sess-42")).toEqual({
      a: "hsl(209 48% 66%)",
      aEnd: "hsl(209 48% 66% / 0%)",
      b: "hsl(278 48% 58%)",
      bEnd: "hsl(278 48% 58% / 0%)",
    });
  });

  it("低饱和带：S 全在 36–48（用户预览定稿的更柔一档）", () => {
    for (let i = 0; i < 60; i++) {
      const c = orbColors(`sess-${i}`);
      for (const stop of [c.a, c.aEnd, c.b, c.bEnd]) {
        expect(hslOf(stop).sat).toBeGreaterThanOrEqual(36);
        expect(hslOf(stop).sat).toBeLessThanOrEqual(48);
      }
    }
  });

  it("亮度锁带：主团 66 / 伴团 58；实心与渐隐端同色", () => {
    for (let i = 0; i < 60; i++) {
      const c = orbColors(`sess-${i}`);
      expect(hslOf(c.a).lightness).toBe(66);
      expect(hslOf(c.b).lightness).toBe(58);
      expect(c.aEnd).toBe(c.a.replace(")", " / 0%)"));
      expect(c.bEnd).toBe(c.b.replace(")", " / 0%)"));
    }
  });

  it("不透明度：两团实心 100%、渐隐端 0（边缘融进背景）", () => {
    for (let i = 0; i < 60; i++) {
      const c = orbColors(`sess-${i}`);
      expect(hslOf(c.a).alpha).toBe(100);
      expect(hslOf(c.aEnd).alpha).toBe(0);
      expect(hslOf(c.b).alpha).toBe(100);
      expect(hslOf(c.bEnd).alpha).toBe(0);
    }
  });

  it("伴色团相对主色团偏移 40–89°，不回卷出界", () => {
    for (let i = 0; i < 60; i++) {
      const { a, b } = orbColors(`sess-${i}`);
      const hue = hslOf(a).hue;
      const shift = (hslOf(b).hue - hue + 360) % 360;
      expect(shift).toBeGreaterThanOrEqual(40);
      expect(shift).toBeLessThan(90);
    }
  });

  it("不同 seed 走出不同的颜色（40 个固定 seed 全不同）", () => {
    const mids = Array.from({ length: 40 }, (_, i) => orbColors(`sess-${i}`).b);
    expect(new Set(mids).size).toBe(40);
  });
});
