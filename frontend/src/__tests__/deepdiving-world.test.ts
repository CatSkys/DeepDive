// DeepDiving 纯模拟核心（game/world.ts）的契约：种子确定性（同种子同输入 → 同世界）、
// 物理方向、单帧步长上限、突石碰撞判死、深度单调与新手缓冲。地形生成是纯函数，
// 这里钉「回放一致」——改物理参数或地形时，先看这里红的对不对。
import { describe, expect, it } from "vitest";
import {
  createWorld,
  depthM,
  DIVER_X,
  randomSeed,
  ROCK_SPACING,
  rockAt,
  rocksInRange,
  scrollSpeed,
  step,
  VIEW_H,
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

  it("超长一帧按 MAX_DT 慢放，不瞬移撞石", () => {
    const next = step({ ...createWorld(1), phase: "run", t: 0 }, { thrust: false }, 10_000);
    expect(next.camera).toBeLessThanOrEqual(scrollSpeed(0) * 0.05 * 1.01);
  });

  it("镜头（深度分数）单调不减", () => {
    let w: World = { ...createWorld(3), phase: "run", t: 0 };
    let prev = depthM(w);
    for (let i = 0; i < 600; i++) {
      w = step(w, { thrust: i % 7 !== 0 }, DT);
      expect(depthM(w)).toBeGreaterThanOrEqual(prev);
      prev = depthM(w);
    }
    expect(w.camera).toBeGreaterThan(0);
  });
});

describe("突石", () => {
  it("前两枚留缓冲：可见范围内不出 2*ROCK_SPACING 之前的石", () => {
    for (const rock of rocksInRange(0, 3 * ROCK_SPACING, 9)) {
      expect(rock.depth).toBeGreaterThanOrEqual(2 * ROCK_SPACING);
    }
  });

  it("突石恒在潜水器车道内（横移躲不开，只能纵向让路）", () => {
    for (let i = 2; i < 200; i++) {
      const rock = rockAt(i, 11);
      expect(Math.abs(rock.x - DIVER_X)).toBeLessThan(rock.r);
    }
  });

  it("撞石判死", () => {
    const w = createWorld(13);
    const rock = rockAt(5, w.seed);
    // 镜头摆到石正中：潜水器 y 视口居中、绝对深度对准石头深度
    const doomed: World = { ...w, phase: "run", camera: rock.depth - VIEW_H / 2, t: 0 };
    expect(step(doomed, { thrust: false }, DT).phase).toBe("dead");
  });
});

describe("难度曲线", () => {
  it("水流速度 90 起步、230 封顶", () => {
    expect(scrollSpeed(0)).toBe(90);
    expect(scrollSpeed(10 ** 9)).toBe(230);
  });

  it("随机种子非零：开局种子在创建时抓定", () => {
    const seed = randomSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(createWorld(seed).seed).toBe(seed);
  });
});
