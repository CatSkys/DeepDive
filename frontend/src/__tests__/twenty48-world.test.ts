// 2048 纯逻辑核心（game/twenty48/world.ts）的契约：折叠只合一次（左优先）、
// 无位移不消费抽次、终局与胜利判定、spawn 确定性（同种子同局）、回放一致。
// 改折叠规则或 spawn 概率时，先看这里红的对不对。
import { describe, expect, it } from "vitest";
import { createGame, GRID, SIZE, step, type Board, type GameState } from "../game/twenty48/world";

const board = (rows: number[][]): Board => rows.flat();
const left = (s: GameState) => step(s, "left");

describe("折叠规则", () => {
  it("[2,2,2,2] 左滑 → [4,4]，得 8 分", () => {
    const s: GameState = {
      seed: 1, score: 0, draws: 0, status: "playing", won: false,
      board: board([[2, 2, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]),
    };
    const res = left(s);
    expect(res.changed).toBe(true);
    expect(res.next.board.slice(0, 4)).toEqual([4, 4, 0, 0]);
    expect(res.gained).toBe(8);
  });

  it("一步只合一次（左优先）：[2,2,4] → [4,4]", () => {
    const s: GameState = {
      seed: 1, score: 0, draws: 0, status: "playing", won: false,
      board: board([[2, 2, 4, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]),
    };
    const res = left(s);
    expect(res.next.board.slice(0, 4)).toEqual([4, 4, 0, 0]);
  });

  it("[4,2,2] 左滑 → [4,4]（右对先合），[2,0,0,2] → [4]", () => {
    const s: GameState = {
      seed: 1, score: 0, draws: 0, status: "playing", won: false,
      board: board([[4, 2, 2, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]),
    };
    expect(left(s).next.board.slice(0, 4)).toEqual([4, 4, 0, 0]);
    const s2: GameState = {
      seed: 1, score: 0, draws: 0, status: "playing", won: false,
      board: board([[2, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]),
    };
    expect(left(s2).next.board[0]).toBe(4);
  });

  it("无位移不消费抽次、状态原引用返回", () => {
    const s: GameState = {
      seed: 1, score: 0, draws: 0, status: "playing", won: false,
      board: board([[2, 4, 8, 16], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]),
    };
    const res = left(s);
    expect(res.changed).toBe(false);
    expect(res.next).toBe(s);
  });
});

describe("终局与胜利", () => {
  it("满盘无相邻同值：走一步即终局", () => {
    const s: GameState = {
      seed: 1, score: 0, draws: 0, status: "playing", won: false,
      board: board([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]),
    };
    const res = left(s);
    expect(res.next.status).toBe("over");
  });

  it("到 2048 打一次性 won 标记，可继续", () => {
    const s: GameState = {
      seed: 1, score: 0, draws: 0, status: "playing", won: false,
      board: board([[1024, 1024, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]),
    };
    const res = left(s);
    expect(res.next.board[0]).toBe(2048);
    expect(res.next.won).toBe(true);
    expect(res.next.status).toBe("playing");
    // won 已置后保持 true（一次性标记，不翻转）
    const res2 = left(res.next);
    expect(res2.next.won).toBe(true);
  });

  it("终局后忽略走子", () => {
    const s: GameState = {
      seed: 1, score: 0, draws: 0, status: "over", won: false,
      board: board([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]),
    };
    expect(left(s).changed).toBe(false);
  });
});

describe("spawn 确定性", () => {
  it("同种子同开局", () => {
    expect(createGame(42)).toEqual(createGame(42));
    expect(createGame(42).board).not.toEqual(createGame(43).board);
  });

  it("回放一致：同种子同走子序列 → 同终态", () => {
    const script = ["left", "up", "right", "down", "left", "up", "right"] as const;
    let a = createGame(7);
    let b = createGame(7);
    for (const dir of script) {
      a = step(a, dir).next;
      b = step(b, dir).next;
    }
    expect(a).toEqual(b);
  });

  it("开局恰两枚、值只可能是 2 或 4", () => {
    const g = createGame(9);
    const tiles = g.board.filter((v) => v !== 0);
    expect(tiles.length).toBe(2);
    for (const v of tiles) expect([2, 4]).toContain(v);
  });
});

describe("棋盘尺寸", () => {
  it("4×4=16：扁平下标与满盘断言的尺", () => {
    expect(GRID).toBe(4);
    expect(SIZE).toBe(16);
  });
});
