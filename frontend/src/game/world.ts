// DeepDiving（深潜）纯模拟核心（横版穿越）：潜水器贴着固定水层向右游，镜头不停
// 右移——按住上浮、松开下沉，躲海沟上下壁与缝内浮石，游程（米）即分数。
// 难度渐入：120m 前无石，石径由小渐大，镜头加速与缝宽收窄同步放缓（约 240m/300m 到顶）。
// 地形由种子确定性生成（整数哈希 + 站距采样），世界只存标量——回放测试与
// 「几乎无限长」都从这把尺子来：没有运行时可变地形状态，step 是纯函数。
// 只管模拟：不管渲染（render.ts）、不管输入/生命周期（DeepDiving.tsx）。

/** 逻辑视口（CSS px）：面板固定 480×320 横版，物理量都以它为尺。 */
export const VIEW_W = 480;
export const VIEW_H = 320;
/** 潜水器固定横坐标（屏幕系）：只操纵纵向，横向是卷轴。 */
export const DIVER_X = 110;
/** 碰撞半径：艇身胶囊的贴近值（塔台/尾鳍略出界，宽容在玩家一侧）。 */
export const DIVER_R = 8;

const GRAVITY = 900; // px/s²：松开时的下沉加速度
const THRUST = 1800; // px/s²：按住时的向上加速度（净上浮 = THRUST - GRAVITY）
const MAX_VY = 260; // px/s
const PX_PER_M = 12; // 12px = 1m：游程读数的尺
const MAX_DT = 50; // 单帧步长上限（ms）：切窗回来的一帧不许瞬移，只许慢放
const STATION = 90; // 地形站距（px，沿游程）

export type Phase = "ready" | "run" | "paused" | "dead";

export interface World {
  readonly seed: number;
  readonly phase: Phase;
  /** 潜水器在视口内的 y。 */
  readonly y: number;
  readonly vy: number;
  /** 镜头已推进 px（游程分数的里程；潜水器的上下浮动不计分）。 */
  readonly camera: number;
  /** 累计时间 ms：ready 相位的浮动动画由它驱动（确定性，不取墙钟）。 */
  readonly t: number;
}

/** 突石：嵌在沟壁上的半圆石（世界系坐标）。 */
export interface Rock {
  /** 世界系 x（= camera + 屏幕系 x）。 */
  wx: number;
  y: number;
  r: number;
}

const READY_Y = VIEW_H / 2;

/** 整数哈希 → [0,1)：同一 (i, seed) 恒同值——地形的原子（渲染层点阵复用这一枚）。 */
export function hash01(i: number, seed: number): number {
  const h = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 新局随机种子：step 对给定 seed 是纯函数，随机性只在开局抓一次。 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

export function createWorld(seed: number): World {
  return { seed, phase: "ready", y: READY_Y, vy: 0, camera: 0, t: 0 };
}

/** 游程分数（米）：只数镜头里程——上下浮动不减分，否则读数会晃。 */
export function distanceM(w: World): number {
  return w.camera / PX_PER_M;
}

/** 镜头速度随游程涨，240m 后封顶 200：难度有天花板，游程没有。 */
export function scrollSpeed(cameraPx: number): number {
  return 80 + Math.min(120, (cameraPx / PX_PER_M) * 0.5);
}

/** 沟缝宽随游程收窄，300m 后到底（110px）：缝有下限，游程没有。 */
export function gapWidth(wx: number): number {
  return Math.max(110, 200 - (wx / PX_PER_M) * 0.3);
}

/** 沟中心线随游程摆动（值噪声：余弦插值），摆幅 130m 后封顶。 */
export function caveCenter(wx: number, seed: number): number {
  const k = Math.floor(wx / STATION);
  const f = wx / STATION - k;
  const s = (1 - Math.cos(f * Math.PI)) / 2;
  const n = hash01(k, seed) + (hash01(k + 1, seed) - hash01(k, seed)) * s;
  const amp = Math.min(90, 40 + (wx / PX_PER_M) * 0.35);
  return VIEW_H / 2 + (n - 0.5) * 2 * amp;
}

/** 沟壁上缘（y）：中心线 ± 半缝，钳在视口内。 */
export function wallTopAt(wx: number, seed: number): number {
  const gap = gapWidth(wx);
  return clamp(caveCenter(wx, seed) - gap / 2, 0, VIEW_H - gap);
}

/** 沟壁下缘（y）：上缘 + 同处缝宽（同一把尺，缝内即活水）。 */
export function wallBottomAt(wx: number, seed: number): number {
  return wallTopAt(wx, seed) + gapWidth(wx);
}

/** 突石：每 ROCK_SPACING 一枚，悬在缝内的浮石；120m 前不出石（难度渐入）。 */
export const ROCK_SPACING = 240;
export const ROCK_START_WX = 1440; // 120m：首次出石
export function rockAt(index: number, seed: number): Rock {
  const wx = index * ROCK_SPACING + hash01(index + 1000, seed) * ROCK_SPACING * 0.5;
  const gap = gapWidth(wx);
  const m = wx / PX_PER_M;
  // 石径随游程渐长：120m 处 ~8px，270m 后到顶 ~26px；封顶保证 (gap-2r)/2 ≥ 16——
  // 石头上下各留 ≥16px 活水，再大也堵不死一条缝
  const base = 8 + Math.min(18, Math.max(0, (m - 120) * 0.12));
  const r = Math.max(6, Math.min(base + (hash01(index + 2000, seed) - 0.5) * 6, (gap - 32) / 2));
  // 石心在缝内上下摆动，但摆幅受活水线约束
  const reach = Math.max(0, gap / 2 - r - 16);
  const mid = (wallTopAt(wx, seed) + wallBottomAt(wx, seed)) / 2;
  return { wx, r, y: mid + (hash01(index + 3000, seed) - 0.5) * 2 * reach };
}

/** 可见（含一圈余量）的突石；ROCK_START_WX 之前不出石。 */
export function rocksInRange(leftWx: number, rightWx: number, seed: number): Rock[] {
  const start = Math.ceil(ROCK_START_WX / ROCK_SPACING);
  const first = Math.max(start, Math.floor(leftWx / ROCK_SPACING) - 1);
  const last = Math.ceil(rightWx / ROCK_SPACING) + 1;
  const out: Rock[] = [];
  for (let i = first; i <= last; i++) out.push(rockAt(i, seed));
  return out;
}

function collides(w: World): boolean {
  const wx = w.camera + DIVER_X;
  if (w.y - DIVER_R < wallTopAt(wx, w.seed) || w.y + DIVER_R > wallBottomAt(wx, w.seed)) return true;
  for (const rock of rocksInRange(wx - 80, wx + 80, w.seed)) {
    const dx = wx - rock.wx;
    const dy = w.y - rock.y;
    if (dx * dx + dy * dy < (rock.r + DIVER_R) ** 2) return true;
  }
  return false;
}

function runStep(w: World, input: { thrust: boolean }, dt: number): World {
  const ay = GRAVITY + (input.thrust ? -THRUST : 0);
  let vy = clamp(w.vy + ay * dt, -MAX_VY, MAX_VY);
  let y = w.y + vy * dt;
  // 视口上下沿是软边界（贴边不死，沟壁与突石照样够得到）：贴住时把 vy 归零，
  // 防止松手瞬间弹走
  if (y < DIVER_R) { y = DIVER_R; vy = Math.max(0, vy); }
  if (y > VIEW_H - DIVER_R) { y = VIEW_H - DIVER_R; vy = Math.min(0, vy); }
  const camera = w.camera + scrollSpeed(w.camera) * dt;
  const next: World = { ...w, vy, y, camera };
  return collides(next) ? { ...next, phase: "dead" } : next;
}

/**
 * 推进一个时间步。ready 相位只走浮动动画（开跑的相位转换归 store/输入处理器，
 * step 只管物理与撞石判死）；paused/dead 定格只走钟。
 * @param dtMs - 距上帧毫秒；超过 MAX_DT 按上限算（后台回来的一帧慢放而不是瞬移撞石）。
 */
export function step(w: World, input: { thrust: boolean }, dtMs: number): World {
  const dt = clamp(dtMs, 0, MAX_DT) / 1000;
  const t = w.t + dtMs;
  if (w.phase === "ready") {
    return { ...w, t, vy: 0, y: READY_Y + Math.sin(t / 500) * 12 };
  }
  if (w.phase !== "run") return { ...w, t };
  return runStep(w, input, dt);
}
