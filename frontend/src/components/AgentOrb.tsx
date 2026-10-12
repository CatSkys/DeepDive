// 子智能体的雾感渐变头像（平面、低饱和、边缘渐隐）：seed → 32 位 DJB2
//（boring-avatars 同款）哈希定主色相；饱和 45–58、边缘色相偏移 40–89°——约束随机，
// 不出脏色（color-hash 的 hue 带思路）。渐变到边缘 alpha 归零，慢慢融进任意亮暗
// 背景（用户 2026-10-12 二轮定稿：平面、不要立体高光——小尺寸下高光不可读；
// 也不是硬边圆片，参考"四周慢慢变淡"的雾感，无形变动画）。
// 配色与渲染同居一个文件（配色是纯函数，vitest 直考；拆成 agentOrb.ts 会与
// AgentOrb.tsx 构成大小写碰撞，在 macOS 不敏感盘上 vite 把 ./AgentOrb 错解析到
// .ts 文件）。已结束行的对勾不归这里表达。
export type OrbColors = { core: string; mid: string; fade: string; edge: string };

const SAT_MIN = 45;
const SAT_RANGE = 14;
const HUE_SHIFT_MIN = 40;
const HUE_SHIFT_RANGE = 50;

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
  const sat = SAT_MIN + Math.floor(h / 360) % SAT_RANGE;
  const shift = HUE_SHIFT_MIN + Math.floor(h / 360 / SAT_RANGE) % HUE_SHIFT_RANGE;
  const h2 = (hue + shift) % 360;
  return {
    core: `hsl(${hue} ${sat}% 66%)`,
    mid: `hsl(${h2} ${sat}% 58%)`,
    fade: `hsl(${h2} ${sat}% 56% / 55%)`,
    edge: `hsl(${h2} ${sat}% 54% / 0%)`,
  };
}

export function AgentOrb({ seed, size, className }: { seed: string; size: number; className?: string }) {
  const { core, mid, fade, edge } = orbColors(seed);
  return (
    <span
      className={`agent-orb${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%", // 16px 小盒上的安全值（PITFALLS §1.1 只警告 999px 式巨大圆角）
        background: `radial-gradient(circle closest-side, ${core} 0%, ${mid} 52%, ${fade} 75%, ${edge} 100%)`,
      }}
    />
  );
}
