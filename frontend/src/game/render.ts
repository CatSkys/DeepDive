// DeepDiving canvas 渲染（横版）：近单色——沟壁/突石/浮游生物/潜水器全走主题 ink
// 灰阶的透明度阶，明暗两主题自动成立（色只经 themeColors() 从语义变量取，画布里
// 不写色值）。只管把世界画出来：不管模拟（world.ts）、不管 DOM 与输入（DeepDiving.tsx）。
import {
  DIVER_R,
  DIVER_X,
  rocksInRange,
  wallBottomAt,
  wallTopAt,
  VIEW_H,
  VIEW_W,
  type World,
} from "./world";
import { hash01 } from "./hash";

export interface GameColors {
  ink: string;
  ink2: string;
  ink3: string;
  /** 窗口底板色（暗主题近黑、亮主题近白）：亮块上的文字用它（明暗自动成立）。 */
  panelBg: string;
}

// 按 data-theme 缓存：明暗切换才重读 computed style，跑帧不碰它
let cache: { theme: string; colors: GameColors } | null = null;

export function themeColors(): GameColors {
  const theme = document.documentElement.dataset.theme ?? "";
  if (cache?.theme === theme) return cache.colors;
  const cs = getComputedStyle(document.documentElement);
  const colors = {
    ink: cs.getPropertyValue("--ink").trim(),
    ink2: cs.getPropertyValue("--ink-2").trim(),
    ink3: cs.getPropertyValue("--ink-3").trim(),
    panelBg: cs.getPropertyValue("--panel-bg").trim(),
  };
  cache = { theme, colors };
  return colors;
}

/** 浮游生物：0.6 视差的静态点阵随镜头左移，给「在前进」提供参照物。 */
function drawPlankton(ctx: CanvasRenderingContext2D, w: World): void {
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = themeColors().ink3;
  // 点阵按 160px 世界站铺，每站 3 枚；0.6 视差 → 屏幕位置 = 世界 x - 0.6×镜头
  const parallax = w.camera * 0.6;
  const first = Math.floor((parallax - 20) / 160);
  for (let s = first; s * 160 < parallax + VIEW_W + 20; s++) {
    for (let k = 0; k < 3; k++) {
      const x = s * 160 + hash01(s * 7 + k, 0) * 160 - parallax;
      const y = 12 + hash01(s * 13 + k * 3, 0) * (VIEW_H - 24);
      ctx.beginPath();
      ctx.arc(x, y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/** 沟壁：上下两块多边形沿壁缘曲线填充 + 壁缘描线（采样步长 12px）。 */
function drawWalls(ctx: CanvasRenderingContext2D, w: World): void {
  const colors = themeColors();
  for (const edge of [wallTopAt, wallBottomAt]) {
    ctx.beginPath();
    ctx.moveTo(0, edge(w.camera, w.seed));
    for (let sx = 12; sx <= VIEW_W; sx += 12) {
      ctx.lineTo(sx, edge(w.camera + sx, w.seed));
    }
    // 壁缘线先描（多边形闭合前的折线即壁缘本身）
    ctx.strokeStyle = colors.ink2;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // 多边形闭合到视口外沿，填充岩体
    if (edge === wallTopAt) {
      ctx.lineTo(VIEW_W, -20);
      ctx.lineTo(0, -20);
    } else {
      ctx.lineTo(VIEW_W, VIEW_H + 20);
      ctx.lineTo(0, VIEW_H + 20);
    }
    ctx.closePath();
    ctx.fillStyle = colors.ink2;
    ctx.globalAlpha = 0.18;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawRocks(ctx: CanvasRenderingContext2D, w: World): void {
  const colors = themeColors();
  for (const rock of rocksInRange(w.camera - 80, w.camera + VIEW_W + 80, w.seed)) {
    ctx.beginPath();
    ctx.arc(rock.wx - w.camera, rock.y, rock.r, 0, Math.PI * 2);
    ctx.fillStyle = colors.ink2;
    ctx.globalAlpha = 0.22;
    ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = colors.ink2;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawDiver(ctx: CanvasRenderingContext2D, w: World): void {
  const colors = themeColors();
  // 螺旋桨气泡尾：三枚拖在艇尾（左侧），位置由 t 确定性摆出，跑帧零状态
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = colors.ink3;
  for (let k = 0; k < 3; k++) {
    const sway = Math.sin(w.t / 170 + k * 2.1) * 3;
    ctx.beginPath();
    ctx.arc(DIVER_X - 16 - k * 7, w.y + sway, 1.8 - k * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // 潜水艇：艇身胶囊 + 塔台 + 潜望镜 + 舷窗 + 尾鳍，随 vy 俯仰；死亡帧画 ✕
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.translate(DIVER_X, w.y);
  ctx.rotate(Math.max(-0.45, Math.min(0.45, w.vy / 500)));
  ctx.fillStyle = colors.ink;
  ctx.beginPath();
  ctx.ellipse(0, 0, 11, 6.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(-2, -11, 8, 6, 2);
  ctx.fill();
  ctx.strokeStyle = colors.ink;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(4, -11);
  ctx.lineTo(4, -15);
  ctx.lineTo(7, -15);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-10, -1.5);
  ctx.lineTo(-15, -5);
  ctx.lineTo(-15, 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = colors.ink3;
  ctx.beginPath();
  ctx.ellipse(4.5, 0, 1.8, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-0.5, 0.5, 1.8, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();
  if (w.phase === "dead") {
    ctx.strokeStyle = colors.ink2;
    ctx.lineWidth = 1.4;
    const s = DIVER_R + 6;
    ctx.beginPath();
    ctx.moveTo(-s, -s);
    ctx.lineTo(s, s);
    ctx.moveTo(s, -s);
    ctx.lineTo(-s, s);
    ctx.stroke();
  }
  ctx.restore();
}

/** 把世界画上画布。画布尺寸由 DeepDiving.tsx 按 dpr 设好（这里只画逻辑 480×320）。 */
export function drawFrame(canvas: HTMLCanvasElement | null, w: World): void {
  const ctx = canvas?.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  drawPlankton(ctx, w);
  drawRocks(ctx, w);
  drawWalls(ctx, w);
  drawDiver(ctx, w);
}
