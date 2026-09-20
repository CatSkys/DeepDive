// 引导收尾的礼花：复刻主流礼花（canvas-confetti 的物理与形态）——彩色纸屑、中心爆发 +
// 两侧斜喷两波、重力 + 阻力 + 自旋 + 翻转（用纵向缩放伪造 3D 翻转），全部粒子落屏外
// 或超时才结束，总时长约 2.6–3.2s。
//
// 自己实现而不是引依赖（铁律 7）：形状/配色/物理都是画布上的几十行，加一个包不值。
// 确定性伪随机（LCG）：同一次庆祝的形状可复现，对截图/复现问题有用。
// 尊重 prefers-reduced-motion：不撒粒子，直接回报结束。
import { useEffect, useRef } from "react";
import css from "./Confetti.module.css";

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  rot: number; vr: number;
  w: number; h: number;
  color: string;
}

/** 主流礼花配色（高饱和多色，暗色界面上够醒目）。 */
const COLORS = ["#26ccff", "#a25afd", "#ff5e7e", "#88ff5a", "#fcff42", "#ffa62d", "#ff36ff"];
const GRAVITY = 0.42;
const DRAG = 0.995;
const MAX_MS = 3200;

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

export function Confetti({ seed = 7, onDone }: { seed?: number; onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { doneRef.current(); return; }
    const ctx = canvas.getContext("2d");
    if (!ctx) { doneRef.current(); return; }

    const rand = makeRandom(seed);
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const particles: Particle[] = [];
    /** 一波：从 (x,y) 朝 angle±spread 喷 count 片。 */
    const burst = (x: number, y: number, count: number, angle: number, spread: number, power: number) => {
      for (let i = 0; i < count; i += 1) {
        const a = angle + (rand() - 0.5) * spread;
        const v = power * (0.55 + rand() * 0.75);
        particles.push({
          x, y,
          vx: Math.sin(a) * v,
          vy: -Math.cos(a) * v,
          rot: rand() * Math.PI * 2,
          vr: (rand() - 0.5) * 0.34,
          w: 6 + rand() * 6,
          h: 8 + rand() * 8,
          color: COLORS[Math.floor(rand() * COLORS.length)] ?? COLORS[0],
        });
      }
    };
    // 起手三波（主流礼花的默认形态：中心偏上爆发 + 两侧斜喷）
    burst(width * 0.5, height * 0.42, 90, 0, Math.PI * 1.7, 13);
    burst(width * 0.22, height * 0.62, 45, -Math.PI / 5, Math.PI * 0.5, 15);
    burst(width * 0.78, height * 0.62, 45, Math.PI / 5, Math.PI * 0.5, 15);

    const started = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - started;
      ctx.clearRect(0, 0, width, height);
      let alive = 0;
      for (const p of particles) {
        p.vy += GRAVITY;
        p.vx *= DRAG;
        p.vy *= DRAG;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        if (p.y < height + 40) alive += 1;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        // 纵向缩放伪造翻转（纸屑翻面时的"变薄"）
        ctx.scale(1, Math.max(0.18, Math.abs(Math.cos(p.rot * 1.6))));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (alive > 0 && elapsed < MAX_MS) {
        raf = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, width, height);
        doneRef.current();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, width, height);
    };
  }, [seed]);

  return <canvas ref={canvasRef} className={css.host} aria-hidden="true" />;
}
