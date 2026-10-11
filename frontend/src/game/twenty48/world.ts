// 2048 纯逻辑核心：4×4 棋盘，方向滑动合数，一步只合一次（左优先）；无合法位移即
// 终局，到 2048 打一次性胜利标记（可继续）。spawn 由 (seed, 抽次) 确定性驱动——
// 回放测试与「同种子同局」同源。只管棋盘与规则：不管渲染（render.ts）、
// 不管输入/生命周期（Game2048.tsx）。
import { hash01 } from "../hash";

export const GRID = 4;
export const SIZE = GRID * GRID;
export const WIN_VALUE = 2048;
export type Board = number[]; // 0 = 空，其余为 2^k
export type Dir = "left" | "right" | "up" | "down";
export type Status = "playing" | "over";

/** 一步的滑块元数据（渲染层补间用）：from（合数时还有 from2）→ to。 */
export interface Move {
  readonly to: number;
  readonly from: number;
  readonly from2?: number;
  readonly merged: boolean;
  readonly value: number;
}

export interface GameState {
  readonly seed: number;
  readonly board: Board;
  readonly score: number;
  /** RNG 抽次：spawn 的确定性计数（每次 spawn 走 2 抽）。 */
  readonly draws: number;
  readonly status: Status;
  readonly won: boolean;
}

export interface StepResult {
  readonly next: GameState;
  readonly changed: boolean;
  readonly moves: Move[];
  readonly spawn: { at: number; value: number } | null;
  readonly gained: number;
}

/** 随机种子：step 对 (seed, 抽次序列) 是纯函数，随机性只在抽次里。 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

// 方向 → 4 条线的扁平下标，按折叠顺序排（left/up 顺向，right/down 逆向）。
function linesOf(dir: Dir): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < GRID; i++) {
    const line: number[] = [];
    for (let j = 0; j < GRID; j++) {
      if (dir === "left") line.push(i * GRID + j);
      else if (dir === "right") line.push(i * GRID + (GRID - 1 - j));
      else if (dir === "up") line.push(j * GRID + i);
      else line.push((GRID - 1 - j) * GRID + i);
    }
    rows.push(line);
  }
  return rows;
}

// 折一条线：压零 → 相邻同值合一次；出滑块元数据（to 按折叠后位置）。
function foldLine(line: readonly number[], board: Board): { moves: Move[]; gained: number } {
  const cells = line.map((at) => ({ v: board[at], at })).filter((c) => c.v !== 0);
  const moves: Move[] = [];
  let gained = 0;
  let k = 0;
  while (k < cells.length) {
    const to = line[moves.length];
    if (k + 1 < cells.length && cells[k].v === cells[k + 1].v) {
      const value = cells[k].v * 2;
      moves.push({ to, from: cells[k].at, from2: cells[k + 1].at, merged: true, value });
      gained += value;
      k += 2;
    } else {
      moves.push({ to, from: cells[k].at, merged: false, value: cells[k].v });
      k += 1;
    }
  }
  return { moves, gained };
}

// 还有没有合法步：有空格，或有相邻同值。
function canMove(board: Board): boolean {
  for (let at = 0; at < SIZE; at++) {
    if (board[at] === 0) return true;
    const r = Math.floor(at / GRID);
    const c = at % GRID;
    if (c + 1 < GRID && board[at + 1] === board[at]) return true;
    if (r + 1 < GRID && board[at + GRID] === board[at]) return true;
  }
  return false;
}

function spawnTile(state: GameState, board: Board): { at: number; value: number } | null {
  const empties = board.map((v, at) => (v === 0 ? at : -1)).filter((at) => at >= 0);
  if (empties.length === 0) return null;
  const at = empties[Math.floor(hash01(state.draws, state.seed) * empties.length)];
  const value = hash01(state.draws + 1, state.seed) < 0.9 ? 2 : 4;
  return { at, value };
}

export function createGame(seed: number): GameState {
  let board: Board = Array<number>(SIZE).fill(0);
  let state: GameState = { seed, board, score: 0, draws: 0, status: "playing", won: false };
  for (let i = 0; i < 2; i++) {
    const spawn = spawnTile(state, board);
    if (!spawn) break;
    board = board.slice();
    board[spawn.at] = spawn.value;
    state = { ...state, board, draws: state.draws + 2 };
  }
  return state;
}

/**
 * 走一步。无位移/合数时不消费抽次、状态原引用返回（changed=false）——但满盘无路时
 * 在这里判负（任何方向都动不了就是终局）。终局后忽略走子（重开归输入处理器）。
 */
export function step(state: GameState, dir: Dir): StepResult {
  if (state.status === "over") {
    return { next: state, changed: false, moves: [], spawn: null, gained: 0 };
  }
  const board: Board = Array<number>(SIZE).fill(0);
  const moves: Move[] = [];
  let gained = 0;
  for (const line of linesOf(dir)) {
    const res = foldLine(line, state.board);
    for (const m of res.moves) {
      board[m.to] = m.value;
      moves.push(m);
    }
    gained += res.gained;
  }
  const changed = moves.some((m) => m.merged || m.to !== m.from);
  if (!changed) {
    return {
      next: canMove(state.board) ? state : { ...state, status: "over" },
      changed: false,
      moves: [],
      spawn: null,
      gained: 0,
    };
  }
  // won 是粘性标记：到过 2048 就保持（后续步不翻转）
  const won = state.won || board.some((v) => v >= WIN_VALUE);
  const spawn = spawnTile(state, board);
  const nextBoard = board.slice();
  if (spawn) nextBoard[spawn.at] = spawn.value;
  const next: GameState = {
    ...state,
    board: nextBoard,
    score: state.score + gained,
    draws: spawn ? state.draws + 2 : state.draws,
    won,
    status: canMove(nextBoard) ? "playing" : "over",
  };
  return { next, changed: true, moves, spawn, gained };
}
