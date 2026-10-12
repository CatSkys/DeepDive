// 子智能体的雾感渐变头像（平面、低饱和、边缘渐隐）：seed → 32 位 DJB2
//（boring-avatars 同款）哈希定主色相；饱和 36–48、伴色相偏移 40–89°——约束随机，
// 不出脏色（color-hash 的 hue 带思路）。画法（用户 2026-10-12 预览定稿）：两团色相
// 错开放在对角——主色团左上、伴色团右下，各自从中心向外溶解，交界自然融合
//（不是"中心亮核 + 同心圆淡出"，那版被否）；圆形剪影与边缘渐隐由 theme.css 的
// .agent-orb 遮罩收出（70% 起淡出；mask 不能走内联 style，PITFALLS §1.9）。
// 配色与渲染同居一个文件（配色是纯函数，vitest 直考；拆成 agentOrb.ts 会与
// AgentOrb.tsx 构成大小写碰撞，在 macOS 不敏感盘上 vite 把 ./AgentOrb 错解析到
// .ts 文件）。已结束行的对勾不归这里表达。
export type OrbColors = { a: string; aEnd: string; b: string; bEnd: string };

const SAT_MIN = 36;
const SAT_RANGE = 13;
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
    a: `hsl(${hue} ${sat}% 66%)`, // 左上主色团
    aEnd: `hsl(${hue} ${sat}% 66% / 0%)`,
    b: `hsl(${h2} ${sat}% 58%)`, // 右下伴色团
    bEnd: `hsl(${h2} ${sat}% 58% / 0%)`,
  };
}

export function AgentOrb({ seed, size, className }: { seed: string; size: number; className?: string }) {
  const { a, aEnd, b, bEnd } = orbColors(seed);
  return (
    <span
      className={`agent-orb${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%", // 16px 小盒上的安全值（PITFALLS §1.1 只警告 999px 式巨大圆角）
        background: `radial-gradient(circle farthest-side at 32% 32%, ${a} 0%, ${aEnd} 100%), radial-gradient(circle farthest-side at 68% 68%, ${b} 0%, ${bEnd} 100%)`,
      }}
    />
  );
}
