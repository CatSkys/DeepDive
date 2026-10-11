// 2048 的模块级状态：开/关请求（Host 消费，DeepDiving store 同款 openReq 模式）、
// 棋局单例（关浮层不销毁——关了再开续局）、最高分（localStorage 纯客户端偏好，
// 端口轮换会清零——与 autoArchive 同一条显式取舍）。音效开关在共享的 soundPref。
import { createGame, randomSeed, type GameState } from "./world";

let openReq: (() => void) | null = null;

/** 打开 2048 浮层（命令面板入口）。 */
export function openGame2048(): void {
  openReq?.();
}

/** Host 挂载时注册打开请求的消费端。 */
export function register2048(fn: (() => void) | null): void {
  openReq = fn;
}

let game: GameState = createGame(randomSeed());

export function currentGame(): GameState {
  return game;
}

export function replaceGame(next: GameState): void {
  game = next;
}

export function newGame(): void {
  game = createGame(randomSeed());
}

const BEST_KEY = "deepdive.2048Best";

/** 最高分（整数）；无记录/存储不可用回 0。 */
export function bestScore(): number {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const n = raw === null ? 0 : Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0; /* 无 localStorage（测试/受限环境）→ 无纪录 */
  }
}

/** 一步落定后提交分数；破纪录落盘回 true。 */
export function submitScore(score: number): boolean {
  const s = Math.floor(score);
  if (s <= bestScore()) return false;
  try {
    localStorage.setItem(BEST_KEY, String(s));
  } catch {
    /* 无 localStorage → 本次纪录只在内存 */
  }
  return true;
}
