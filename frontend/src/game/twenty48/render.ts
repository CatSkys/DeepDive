// 2048 canvas 渲染：经典黑白——棋盘/格子/数字全走主题 ink 灰阶透明度阶，数值越大
// 块越亮（暗主题）/越暗（亮主题），高值块的文字用窗口底板色——明暗两主题自动成立，
// 色只经 themeColors()（共享自 ../render）取，画布里不写色值。滑动补间按 moveAt
// 时间戳算（ease-out 110ms），合数 = 两块滑到一处，新块延迟淡入。
import { GRID, SIZE, type Board, type Move } from "./world";
import { themeColors } from "../render";

/** 棋盘几何（canvas 逻辑 px）：8 边距 + 4×78 格 + 3×8 缝 = 352。 */
export const CELL = 78;
export const GAP = 8;
export const PAD = 8;
export const BOARD_PX = PAD * 2 + GRID * CELL + (GRID - 1) * GAP;

const SLIDE_MS = 110;

const at = (i: number): { x: number; y: number } => ({
  x: PAD + (i % GRID) * (CELL + GAP),
  y: PAD + Math.floor(i / GRID) * (CELL + GAP),
});

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// 值 → 阶：k=log2(v)；块底 alpha 2→.10 … 2048→.92；k≤5 用 ink 字，亮块用底板色字
function tileStyle(value: number): { bgAlpha: number; dark: boolean } {
  const k = Math.max(1, Math.round(Math.log2(value)));
  return { bgAlpha: Math.min(0.92, 0.1 + (k - 1) * 0.082), dark: k > 5 };
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  value: number,
  alpha: number,
): void {
  const colors = themeColors();
  const { bgAlpha, dark } = tileStyle(value);
  ctx.globalAlpha = bgAlpha * alpha;
  ctx.fillStyle = colors.ink;
  ctx.beginPath();
  ctx.roundRect(x, y, CELL, CELL, 8);
  ctx.fill();
  const digits = String(value).length;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = dark ? colors.panelBg : colors.ink;
  ctx.font = `700 ${digits <= 2 ? 30 : digits === 3 ? 24 : 18}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(value), x + CELL / 2, y + CELL / 2 + 1);
  ctx.globalAlpha = 1;
}

export interface BoardView {
  board: Board;
  moves: Move[];
  spawn: { at: number; value: number } | null;
  /** 上一手的 performance.now() 时间戳（0 = 无动画）。 */
  moveAt: number;
}

export function drawBoard(canvas: HTMLCanvasElement | null, view: BoardView): void {
  const ctx = canvas?.getContext("2d");
  if (!ctx) return;
  const colors = themeColors();
  ctx.clearRect(0, 0, BOARD_PX, BOARD_PX);
  // 底板与空槽
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = colors.ink;
  ctx.beginPath();
  ctx.roundRect(0, 0, BOARD_PX, BOARD_PX, 10);
  ctx.fill();
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < SIZE; i++) {
    const p = at(i);
    ctx.beginPath();
    ctx.roundRect(p.x, p.y, CELL, CELL, 8);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 滑动补间进度（ease-out）
  const t = view.moveAt ? Math.min(1, Math.max(0, (performance.now() - view.moveAt) / SLIDE_MS)) : 1;
  const ease = 1 - (1 - t) ** 3;
  for (let i = 0; i < SIZE; i++) {
    if (view.board[i] === 0) continue;
    const p = at(i);
    const isNew = view.spawn !== null && view.spawn.at === i;
    const move = view.moves.find((m) => m.to === i);
    if (t < 1 && isNew) {
      drawTile(ctx, p.x, p.y, view.board[i], ease);
      continue;
    }
    if (t < 1 && move) {
      const a = at(move.from);
      const b = at(move.to);
      if (move.merged && move.from2 !== undefined) {
        const a2 = at(move.from2);
        const half = view.board[i] / 2;
        drawTile(ctx, lerp(a.x, b.x, ease), lerp(a.y, b.y, ease), half, 1);
        drawTile(ctx, lerp(a2.x, b.x, ease), lerp(a2.y, b.y, ease), half, 1);
        continue;
      }
      drawTile(ctx, lerp(a.x, b.x, ease), lerp(a.y, b.y, ease), view.board[i], 1);
      continue;
    }
    drawTile(ctx, p.x, p.y, view.board[i], 1);
  }
}
