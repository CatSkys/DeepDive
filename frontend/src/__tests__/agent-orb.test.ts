// AgentOrb 的纯函数门：哈希确定性、颜色约束带（S/L/偏移锁定）、形状 7 种全撒到、
// 多边形 path 合法且不出界。输入全是固定 seed——函数是纯的，跑多少遍结果都一样。
import { describe, expect, it } from "vitest";
import { ORB_SHAPES, orbColors, orbHash, polygonPath, shapeOf } from "../components/AgentOrb";

const HSL_RE = /^hsl\((\d+) (\d+)% (\d+)%\)$/;

function hslOf(color: string): { hue: number; sat: number; lightness: number } {
  const m = HSL_RE.exec(color);
  expect(m, color).toBeTruthy();
  return { hue: Number(m![1]), sat: Number(m![2]), lightness: Number(m![3]) };
}

describe("orbHash：boring-avatars 同款 32 位 DJB2", () => {
  it("已知向量钉住算法；同一 seed 恒等", () => {
    expect(orbHash("abc")).toBe(96354);
    expect(orbHash("sess-42")).toBe(1984928249);
    expect(orbHash("sess-42")).toBe(orbHash("sess-42"));
  });
});

describe("orbColors：平涂线性两色（S 36–48，L 76/68，偏移 40–89°）", () => {
  it("同一 seed 永远同色", () => {
    expect(orbColors("sess-42")).toEqual(orbColors("sess-42"));
  });

  it("已知向量：sess-42 → 主色 hue 209 / 伴色 hue 278（偏移 69）", () => {
    expect(orbColors("sess-42")).toEqual({ a: "hsl(209 48% 76%)", b: "hsl(278 48% 68%)" });
  });

  it("低饱和带：S 全在 36–48；亮度锁在主 76 / 伴 68（更亮档定稿）", () => {
    for (let i = 0; i < 60; i++) {
      const { a, b } = orbColors(`sess-${i}`);
      expect(hslOf(a).sat).toBeGreaterThanOrEqual(36);
      expect(hslOf(a).sat).toBeLessThanOrEqual(48);
      expect(hslOf(b).sat).toBeGreaterThanOrEqual(36);
      expect(hslOf(b).sat).toBeLessThanOrEqual(48);
      expect(hslOf(a).lightness).toBe(76);
      expect(hslOf(b).lightness).toBe(68);
    }
  });

  it("伴色相相对主色相偏移 40–89°，不回卷出界", () => {
    for (let i = 0; i < 60; i++) {
      const { a, b } = orbColors(`sess-${i}`);
      const shift = (hslOf(b).hue - hslOf(a).hue + 360) % 360;
      expect(shift).toBeGreaterThanOrEqual(40);
      expect(shift).toBeLessThan(90);
    }
  });

  it("不同 seed 走出不同的颜色（40 个固定 seed 全不同）", () => {
    const bs = Array.from({ length: 40 }, (_, i) => orbColors(`sess-${i}`).b);
    expect(new Set(bs).size).toBe(40);
  });
});

describe("shapeOf：加盐重散列 → 7 种形状", () => {
  it("同一 seed 永远同一形状，且必在形状集里", () => {
    expect(shapeOf("sess-42")).toBe(shapeOf("sess-42"));
    expect(ORB_SHAPES).toContain(shapeOf("sess-42"));
  });

  it("已知向量：sess-42 → 圆角五边（加盐 #shape）", () => {
    expect(shapeOf("sess-42").name).toBe("圆角五边");
  });

  it("60 个同前缀 seed 全部 7 种形状都撒到（盐值防坍缩的直接证据）", () => {
    const hit = new Set(Array.from({ length: 60 }, (_, i) => ORB_SHAPES.indexOf(shapeOf(`sess-${i}`))));
    expect(hit.size).toBe(ORB_SHAPES.length);
  });
});

describe("polygonPath：圆角正多边形 clip-path", () => {
  it("M 开头 Z 收尾，Q 命令数=边数", () => {
    for (const kind of [3, 4, 5, 6] as const) {
      const d = polygonPath(kind, 16, 0.26);
      expect(d.startsWith("M ")).toBe(true);
      expect(d.endsWith("Z")).toBe(true);
      expect((d.match(/Q /g) ?? []).length).toBe(kind);
    }
  });

  it("全部坐标落在盒子内（不越过 0–size，留余量也不为负）", () => {
    for (const kind of [3, 4, 5, 6] as const) {
      for (const size of [13, 14, 16]) {
        const nums = polygonPath(kind, size, 0.3).match(/-?[\d.]+/g)!.map(Number);
        for (const v of nums) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(size);
        }
      }
    }
  });
});
