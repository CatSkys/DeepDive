// DeepDiving 的模块级状态：开/关请求（Host 消费，CommandPalette 同款 openReq 模式）、
// 世界单例（关掉浮层不销毁——「随时取消，再开从原地继续」）、最高深度与提示音开关
// （localStorage：纯客户端偏好，桥端口轮换会清零——与 autoArchive 同一条显式取舍，
// 见 prefs.ts 头注）。只管状态与生命周期：不管模拟（world.ts）与渲染（DeepDiving.tsx）。
import { createWorld, randomSeed, type World } from "./world";

let openReq: (() => void) | null = null;

/** 打开 DeepDiving 浮层（流末 loader「Deep diving...」与命令面板都走这里）。 */
export function openDeepDiving(): void {
  openReq?.();
}

/** Host 挂载时注册打开请求的消费端。 */
export function registerDeepDiving(fn: (() => void) | null): void {
  openReq = fn;
}

let world: World = createWorld(randomSeed());

export function currentWorld(): World {
  return world;
}

export function replaceWorld(next: World): void {
  world = next;
}

/** 运行中才收效：定格为 paused（关浮层/失焦/切窗都经这里）。 */
export function pauseWorld(): void {
  if (world.phase === "run") world = { ...world, phase: "paused" };
}

export function resumeWorld(): void {
  if (world.phase === "paused") world = { ...world, phase: "run" };
}

const BEST_KEY = "deepdive.deepdivingBest";
const SOUND_KEY = "deepdive.deepdivingSound";

/** 最高深度（米，整数）；无记录/存储不可用回 0。 */
export function bestDepth(): number {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const n = raw === null ? 0 : Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0; /* 无 localStorage（测试/受限环境）→ 无纪录 */
  }
}

/** 一局结束后提交深度；破纪录时落盘并回 true。 */
export function submitDepth(meters: number): boolean {
  const m = Math.floor(meters);
  if (m <= bestDepth()) return false;
  try {
    localStorage.setItem(BEST_KEY, String(m));
  } catch {
    /* 无 localStorage → 本次纪录只在内存 */
  }
  return true;
}

/** 提示音开关，默认开。 */
export function soundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "0";
  } catch {
    return true; /* 无 localStorage（测试/受限环境）→ 默认开 */
  }
}

export function setSoundOn(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? "1" : "0");
  } catch {
    /* 无 localStorage → 本次只在内存 */
  }
}
