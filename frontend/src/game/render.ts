// DeepDiving canvas 渲染：近单色——浮游生物/突石/潜水器全走主题 ink 灰阶的透明度
// 阶，明暗两主题自动成立（色只经 themeColors() 从语义变量取，画布里不写色值）。
// 只管把世界画出来：不管模拟（world.ts）、不管 DOM 与输入（DeepDiving.tsx）。
import {
  DIVER_R,
  DIVER_X,
  hash01,
  rocksInRange,
  VIEW_H,
  VIEW_W,
  type World,
} from "./world";

export interface GameColors {
  ink: string;
  ink2: string;
  ink3: string;
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
  };
  cache = { theme, colors };
  return colors;
}

/** 浮游生物：0.6 视差的静态点阵随镜头上移，给「在下潜」提供参照物。 */
function drawPlankton(ctx: CanvasRenderingContext2D, w: World): void {
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = themeColors().ink3;
  // 点阵按 160px 深度站铺，每站 3 枚；0.6 视差 → 采样镜头的 0.6 倍里程
  const parallax = w.camera * 0.6;
  const first = Math.floor((parallax - 20) / 160);
  for (let s = first; s * 160 < parallax + VIEW_H + 20; s++) {
    for (let k = 0; k < 3; k++) {
      const x = 12 + hash01(s * 7 + k, 0) * (VIEW_W - 24);
      const y = s * 160 + hash01(s * 13 + k * 3, 0) * 160 - parallax;
      ctx.beginPath();
      ctx.arc(x, y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawRocks(ctx: CanvasRenderingContext2D, w: World): void {
  const colors = themeColors();
  for (const rock of rocksInRange(w.camera - 80, w.camera + VIEW_H + 80, w.seed)) {
    const sy = rock.depth - w.camera;
    ctx.beginPath();
    ctx.arc(rock.x, sy, rock.r, 0, Math.PI * 2);
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
  // 气泡尾：三枚由潜水器身后（上方）拖出，位置由 t 确定性摆出，跑帧零状态
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = colors.ink3;
  for (let k = 0; k < 3; k++) {
    const sway = Math.sin(w.t / 170 + k * 2.1) * 3;
    ctx.beginPath();
    ctx.arc(DIVER_X + sway, w.y - DIVER_R - 5 - k * 7, 1.8 - k * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // 潜水器：实心圆 + 姿态短轴（按 vy 俯仰），死亡帧画 ✕
  ctx.globalAlpha = 1;
  ctx.fillStyle = colors.ink;
  ctx.beginPath();
  ctx.arc(DIVER_X, w.y, DIVER_R, 0, Math.PI * 2);
  ctx.fill();
  const tilt = Math.max(-0.6, Math.min(0.6, w.vy / 400));
  ctx.strokeStyle = colors.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(DIVER_X - Math.cos(tilt) * (DIVER_R + 3), w.y - Math.sin(tilt) * (DIVER_R + 3));
  ctx.lineTo(DIVER_X + Math.cos(tilt) * (DIVER_R + 3), w.y + Math.sin(tilt) * (DIVER_R + 3));
  ctx.stroke();
  if (w.phase === "dead") {
    ctx.strokeStyle = colors.ink2;
    ctx.lineWidth = 1.4;
    const s = DIVER_R + 6;
    ctx.beginPath();
    ctx.moveTo(DIVER_X - s, w.y - s);
    ctx.lineTo(DIVER_X + s, w.y + s);
    ctx.moveTo(DIVER_X + s, w.y - s);
    ctx.lineTo(DIVER_X - s, w.y + s);
    ctx.stroke();
  }
}

/** 把世界画上画布。画布尺寸由 DeepDiving.tsx 按 dpr 设好（这里只画逻辑 320×480）。 */
export function drawFrame(canvas: HTMLCanvasElement | null, w: World): void {
  const ctx = canvas?.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  drawPlankton(ctx, w);
  drawRocks(ctx, w);
  drawDiver(ctx, w);
}
