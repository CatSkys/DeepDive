// 子智能体的渐变球头像：seed（子会话 id）→ 约束随机的流体球，同一子智能体永远
// 同色、跨重启稳定。配色与渲染同居一个文件（配色是纯函数，vitest 直考；拆成
// agentOrb.ts 会与 AgentOrb.tsx 构成大小写碰撞，在 macOS 不敏感盘上 vite 把
// ./AgentOrb 错解析到 .ts 文件）。只管画这一颗球；已结束行的对勾不归这里表达。
// 算法：哈希照 boring-avatars 的 32 位 DJB2 定色相；饱和/亮度与边缘色相偏移锁在
// 精调带内——约束随机，不出脏色（color-hash 的 hue 带同思路），亮暗两版背景都成立。
export type OrbColors = { highlight: string; mid: string; edge: string };

const SAT_BANDS = [66, 74];
const HUE_SHIFT_MIN = 30;
const HUE_SHIFT_RANGE = 40;

export function orbHash(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash = hash & hash; // 32 位截断
  }
  return Math.abs(hash);
}

export function orbColors(seed: string): OrbColors {
  const h = orbHash(seed);
  const hue = h % 360;
  const sat = SAT_BANDS[Math.floor(h / 360) % SAT_BANDS.length];
  const shift = HUE_SHIFT_MIN + Math.floor(h / 360 / SAT_BANDS.length) % HUE_SHIFT_RANGE;
  return {
    highlight: `hsl(${hue} ${sat}% 72%)`,
    mid: `hsl(${hue} ${sat}% 56%)`,
    edge: `hsl(${(hue + shift) % 360} ${sat}% 45%)`,
  };
}

export function AgentOrb({ seed, size, className }: { seed: string; size: number; className?: string }) {
  const { highlight, mid, edge } = orbColors(seed);
  return (
    <span
      className={`agent-orb${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%", // 16px 小盒上的安全值（PITFALLS §1.1 只警告 999px 式巨大圆角）
        background: `radial-gradient(circle at 30% 30%, ${highlight}, ${mid} 45%, ${edge} 100%)`,
        boxShadow: "inset 0 -1px 2px rgba(0, 0, 0, 0.18)",
      }}
    />
  );
}
