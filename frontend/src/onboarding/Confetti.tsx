// 引导收尾的礼花：单色系粒子（与整体黑白气质一致），无新依赖、无外部资产。
//
// 形态参考 UI 参考库的粒子类效果（juiceeffect / snowfall：密度、初速、旋转、淡出），
// 这里按同一形态自己实现：一次性爆发 → 重力下落 → 淡出，跑完即自行卸载。
// 纪律：① 片数/时长/色阶是常量（可调一处）；② 轨迹用 Web Animations API 逐片下发，
// 不铺 60 条 CSS keyframes；③ 尊重 prefers-reduced-motion（不撒粒子，交给音效收尾）。
import { useEffect, useRef } from "react";
import css from "./Confetti.module.css";

const PIECES = 70;
const DURATION_MS = 1500;
/** 单色系：纸屑用亮/中/暗三档白灰（--ink-bright 系），与界面同一材质语言。 */
const COLORS = ["rgba(255,255,255,.92)", "rgba(226,228,233,.85)", "rgba(160,163,170,.75)"];
const WIDTHS = [5, 7, 9];

/** 确定性伪随机（LCG）：同一次庆祝的形状可复现，出问题时能对着截图比对。 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

export function Confetti({ seed = 1, onDone }: { seed?: number; onDone: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) { onDone(); return; }

    const rand = makeRandom(seed);
    const hostRect = host.getBoundingClientRect();
    const originX = hostRect.width / 2;
    const originY = hostRect.height * 0.52;
    let finished = 0;

    for (let i = 0; i < PIECES; i += 1) {
      const piece = document.createElement("span");
      piece.className = css.piece;
      piece.style.width = `${WIDTHS[i % WIDTHS.length]}px`;
      piece.style.height = `${WIDTHS[i % WIDTHS.length] * 1.6}px`;
      piece.style.background = COLORS[i % COLORS.length];
      host.appendChild(piece);

      // 初速：以向上为主的扇形（±62°），越靠中间的越高；横向另有轻微散开。
      const angle = (rand() - 0.5) * Math.PI * 0.7;
      const power = 140 + rand() * 190;
      const dx = Math.sin(angle) * power;
      const rise = Math.cos(angle) * power;
      const spin = (rand() - 0.5) * 720;
      const fall = 220 + rand() * 200; // 重力下落距离

      const animation = piece.animate(
        [
          { transform: `translate3d(${originX}px, ${originY}px, 0) rotate(0deg)`, opacity: 0 },
          { transform: `translate3d(${originX + dx * 0.55}px, ${originY - rise}px, 0) rotate(${spin * 0.6}deg)`, opacity: 1, offset: 0.32 },
          { transform: `translate3d(${originX + dx}px, ${originY - rise + fall}px, 0) rotate(${spin}deg)`, opacity: 0 },
        ],
        { duration: DURATION_MS, easing: "cubic-bezier(.22,.9,.24,1)", delay: rand() * 90, fill: "forwards" },
      );
      animation.onfinish = () => {
        piece.remove();
        finished += 1;
        if (finished === PIECES) onDone();
      };
      animation.oncancel = () => { piece.remove(); };
    }
    return () => { host.replaceChildren(); };
    // 只撒一次：seed 变才算新的一轮（本轮固定 1）
  }, [seed, onDone]);

  return <div ref={hostRef} className={css.host} aria-hidden="true" />;
}
