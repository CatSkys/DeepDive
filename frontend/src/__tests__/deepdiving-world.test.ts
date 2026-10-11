// DeepDiving 纯模拟核心（game/world.ts，横版穿越）的契约：种子确定性（同种子同输入 →
// 同世界）、物理方向、单帧步长上限、沟缝几何、突石嵌壁与碰撞判死、游程单调与新手缓冲。
// 地形生成是纯函数，这里钉「回放一致」——改物理参数或地形时，先看这里红的对不对。
import { describe, expect, it } from "vitest";
import {
  createWorld,
  distanceM,
  DIVER_X,
  gapWidth,
  randomSeed,
  ROCK_SPACING,
  rockAt,
  rocksInRange,
  scrollSpeed,
  step,
  VIEW_H,
  wallBottomAt,
  wallTopAt,
  type World,
} from "../game/world";

const DT = 16.7; // ≈60fps 一帧

function run(w: World, thrust: boolean[], dt = DT): World {
  let cur = w;
  for (const t of thrust) cur = step(cur, { thrust: t }, dt);
  return cur;
}

describe("回放一致性", () => {
  it("同种子同输入序列 → 同一个世界", () => {
    const script = [true, true, false, true, false, false, false, true, true, false];
    const a = run(createWorld(42), script);
    const b = run(createWorld(42), script);
    expect(a).toEqual(b);
  });

  it("同一 (index, seed) 恒出同一块突石", () => {
    expect(rockAt(5, 7)).toEqual(rockAt(5, 7));
    expect(rockAt(5, 7)).not.toEqual(rockAt(5, 8));
  });
});

describe("相位与物理", () => {
  it("ready 相位不推进镜头，开跑的相位转换归输入处理器", () => {
    const next = step(createWorld(1), { thrust: true }, DT);
    expect(next.phase).toBe("ready");
    expect(next.camera).toBe(0);
  });

  it("松开下沉（vy 增、y 增），按住上浮（vy 减）", () => {
    const sink = run({ ...createWorld(1), phase: "run", t: 0 }, [false, false, false]);
    expect(sink.vy).toBeGreaterThan(0);
    expect(sink.y).toBeGreaterThan(VIEW_H / 2);
    const rise = run({ ...createWorld(1), phase: "run", t: 0 }, [true, true, true]);
    expect(rise.vy).toBeLessThan(0);
    expect(rise.y).toBeLessThan(VIEW_H / 2);
  });

  it("超长一帧按 MAX_DT 慢放，不瞬移撞壁", () => {
    const next = step({ ...createWorld(1), phase: "run", t: 0 }, { thrust: false }, 10_000);
    expect(next.camera).toBeLessThanOrEqual(scrollSpeed(0) * 0.05 * 1.01);
  });

  it("镜头（游程分数）单调不减", () => {
    let w: World = { ...createWorld(3), phase: "run", t: 0 };
    let prev = distanceM(w);
    for (let i = 0; i < 600; i++) {
      w = step(w, { thrust: i % 7 !== 0 }, DT);
      expect(distanceM(w)).toBeGreaterThanOrEqual(prev);
      prev = distanceM(w);
    }
    expect(w.camera).toBeGreaterThan(0);
  });
});

describe("沟缝几何", () => {
  it("下缘 = 上缘 + 缝宽，壁缘恒在视口内", () => {
    for (let wx = 0; wx < 50_000; wx += 130) {
      const top = wallTopAt(wx, 9);
      expect(wallBottomAt(wx, 9)).toBeCloseTo(top + gapWidth(wx), 6);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top + gapWidth(wx)).toBeLessThanOrEqual(VIEW_H);
    }
  });

  it("缝宽 190 起步、100 到底", () => {
    expect(gapWidth(0)).toBe(190);
    expect(gapWidth(10 ** 9)).toBe(100);
  });
});

describe("突石", () => {
  it("难度渐入：ROCK_START_WX 前不出石", () => {
    const rocks = rocksInRange(0, 7 * ROCK_SPACING, 9);
    expect(rocks.length).toBeGreaterThan(0);
    for (const rock of rocks) expect(rock.wx).toBeGreaterThanOrEqual(1200);
  });

  it("突石悬在缝内，两侧各留 ≥16px 活水", () => {
    for (let i = 6; i < 200; i++) {
      const rock = rockAt(i, 11);
      expect(rock.y - rock.r).toBeGreaterThanOrEqual(wallTopAt(rock.wx, 11) + 16 - 1e-6);
      expect(rock.y + rock.r).toBeLessThanOrEqual(wallBottomAt(rock.wx, 11) - 16 + 1e-6);
    }
  });

  it("撞石判死", () => {
    const w = createWorld(13);
    const rock = rockAt(8, w.seed);
    // 镜头摆到石正中：潜水器横坐标对准石头、y 对准石心
    const doomed: World = { ...w, phase: "run", camera: rock.wx - DIVER_X, y: rock.y, t: 0 };
    expect(step(doomed, { thrust: false }, DT).phase).toBe("dead");
  });

  it("石径随游程渐长：100m 处小石，250m 后封顶 ~30px", () => {
    const small = rockAt(Math.ceil(1200 / ROCK_SPACING), 5);
    expect(small.r).toBeLessThan(16);
    const late = rockAt(Math.ceil(60_000 / ROCK_SPACING), 5);
    expect(late.r).toBeLessThanOrEqual(33);
  });
});

describe("难度曲线", () => {
  it("镜头速度 90 起步、230 封顶", () => {
    expect(scrollSpeed(0)).toBe(90);
    expect(scrollSpeed(10 ** 9)).toBe(230);
  });

  it("随机种子非零：开局种子在创建时抓定", () => {
    const seed = randomSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(createWorld(seed).seed).toBe(seed);
  });
});
