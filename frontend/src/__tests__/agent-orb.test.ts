// AgentOrb 配色的纯函数门：哈希确定性、约束带（S/L 锁定）、撞色是例外不是常态。
// 输入全是固定 seed——函数是纯的，跑多少遍结果都一样，不存在概率性红。
import { describe, expect, it } from "vitest";
import { orbColors, orbHash } from "../components/AgentOrb";

const HSL_RE = /^hsl\((\d+) (\d+)% (\d+)%\)$/;

describe("orbHash：boring-avatars 同款 32 位 DJB2", () => {
  it("已知向量钉住算法；同一 seed 恒等", () => {
    expect(orbHash("abc")).toBe(96354);
    expect(orbHash("sess-42")).toBe(1984928249);
    expect(orbHash("sess-42")).toBe(orbHash("sess-42"));
  });
});

describe("orbColors：约束随机（hue 全轮，S/L 锁带）", () => {
  it("同一 seed 永远同一颗球", () => {
    expect(orbColors("sess-42")).toEqual(orbColors("sess-42"));
  });

  it("已知向量：sess-42 → hue 209 / sat 74 / 边缘 hue 243", () => {
    expect(orbColors("sess-42")).toEqual({
      highlight: "hsl(209 74% 72%)",
      mid: "hsl(209 74% 56%)",
      edge: "hsl(243 74% 45%)",
    });
  });

  it("三层颜色全在精调带内：S∈{66,74}，L∈{72,56,45}", () => {
    for (let i = 0; i < 60; i++) {
      const c = orbColors(`sess-${i}`);
      for (const [key, lightness] of [["highlight", 72], ["mid", 56], ["edge", 45]] as const) {
        const m = HSL_RE.exec(c[key]);
        expect(m, `sess-${i}.${key}: ${c[key]}`).toBeTruthy();
        expect(Number(m![1])).toBeLessThan(360);
        expect([66, 74]).toContain(Number(m![2]));
        expect(Number(m![3])).toBe(lightness);
      }
    }
  });

  it("边缘色相相对主色相偏移 30–69°，不回卷出界", () => {
    for (let i = 0; i < 60; i++) {
      const { mid, edge } = orbColors(`sess-${i}`);
      const hue = Number(HSL_RE.exec(mid)![1]);
      const edgeHue = Number(HSL_RE.exec(edge)![1]);
      const shift = (edgeHue - hue + 360) % 360;
      expect(shift).toBeGreaterThanOrEqual(30);
      expect(shift).toBeLessThan(70);
    }
  });

  it("不同 seed 走出不同的球（40 个固定 seed 全不同）", () => {
    const mids = Array.from({ length: 40 }, (_, i) => orbColors(`sess-${i}`).mid);
    expect(new Set(mids).size).toBe(40);
  });
});
