// 子智能体的渐变形状头像（平面、低饱和、边缘薄雾）：seed → 32 位 DJB2
//（boring-avatars 同款）哈希定色相与形状。渐变=平涂线性对角（135°，无亮斑，
// 用户 2026-10-12 定稿；错位双团被否——"还是有高光"）；饱和 36–48、主色 L76 /
// 伴色 L68（"更亮一档"定稿）、伴色相偏移 40–89°——约束随机不出脏色（color-hash
// 的 hue 带思路）。形状 7 种圆角（圆/方/三角/菱/五边/六边/squircle）随 seed，
// 多边形 clip-path 按 size 现算；边缘薄雾由 theme.css 的 .agent-orb 遮罩收出
//（实心到 85% 再淡出；mask 不能走内联 style，PITFALLS §1.9）。无动画。
// 配色与渲染同居一个文件（纯函数 vitest 直考；拆成 agentOrb.ts 会与 AgentOrb.tsx
// 构成大小写碰撞，在 macOS 不敏感盘上 vite 把 ./AgentOrb 错解析到 .ts 文件）。
// 已结束行的对勾不归这里表达。
export type OrbColors = { a: string; b: string };

const SAT_MIN = 36;
const SAT_RANGE = 13;
const HUE_SHIFT_MIN = 40;
const HUE_SHIFT_RANGE = 50;
// 亮度（用户定稿"更亮一档"）：主色 76 / 伴色 68，饱和不动
const LIGHTNESS_A = 76;
const LIGHTNESS_B = 68;

export type OrbShape = { name: string; kind: 0 | 3 | 4 | 5 | 6 | 9 | 10; corner: number };

// 形状集（用户预览定稿 7 种）：kind=多边形边数，0=方、9=squircle（这两类走
// border-radius）、10=圆；corner=圆角比（定稿"圆角再大一些"）。改集合要连
// agent-orb.test.ts 的分布断言一起看。
export const ORB_SHAPES: OrbShape[] = [
  { name: "圆", kind: 10, corner: 0 },
  { name: "圆角方", kind: 0, corner: 0.34 },
  { name: "圆角三角", kind: 3, corner: 0.3 },
  { name: "圆角菱", kind: 4, corner: 0.28 },
  { name: "圆角五边", kind: 5, corner: 0.26 },
  { name: "圆角六边", kind: 6, corner: 0.24 },
  { name: "squircle", kind: 9, corner: 0.46 },
];

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
  return {
    a: `hsl(${hue} ${sat}% ${LIGHTNESS_A}%)`, // 135° 起点端
    b: `hsl(${(hue + shift) % 360} ${sat}% ${LIGHTNESS_B}%)`, // 终点端
  };
}

// seed → 形状。加盐重散列（"#shape" 域分离）：同前缀短 id 经主哈希会一起移动、
// 除链坍缩（实测 sess-0..59 只命中 2 种形状），盐值让整个串重新雪崩。
export function shapeOf(seed: string): OrbShape {
  return ORB_SHAPES[Math.floor(orbHash(`${seed}#shape`) % ORB_SHAPES.length)];
}

// 圆角正多边形的 clip-path（二次贝塞尔收角，像素坐标按 size 现算）。
// 方/squircle（kind 0/9）与圆（kind 10）不归这里——前两类 borderRadius、圆 50%。
export function polygonPath(kind: 3 | 4 | 5 | 6, size: number, cornerRatio: number): string {
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 * 0.97; // 留 3% 余量，防像素取整出裁切边
  const r = R * cornerRatio;
  const verts = Array.from({ length: kind }, (_, i) => {
    const ang = -Math.PI / 2 + i * 2 * Math.PI / kind; // 顶点朝上起步
    return [cx + R * Math.cos(ang), cy + R * Math.sin(ang)] as const;
  });
  const pts = verts.map(([x, y], i) => {
    const prev = verts[(i - 1 + kind) % kind], next = verts[(i + 1) % kind];
    const unit = (p: readonly number[]) => {
      const dx = p[0] - x, dy = p[1] - y, len = Math.hypot(dx, dy);
      return [dx / len, dy / len] as const;
    };
    const up = unit(prev), un = unit(next);
    return { x, y, a: [x + up[0] * r, y + up[1] * r] as const, b: [x + un[0] * r, y + un[1] * r] as const };
  });
  let d = `M ${pts[0].b[0].toFixed(2)} ${pts[0].b[1].toFixed(2)} `;
  for (let i = 1; i <= kind; i++) {
    const p = pts[i % kind];
    d += `L ${p.a[0].toFixed(2)} ${p.a[1].toFixed(2)} Q ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.b[0].toFixed(2)} ${p.b[1].toFixed(2)} `;
  }
  return `${d}Z`;
}

export function AgentOrb({ seed, size, className }: { seed: string; size: number; className?: string }) {
  const { a, b } = orbColors(seed);
  const shape = shapeOf(seed);
  // 圆=50% 圆角；方/squircle=borderRadius；多边形=clip-path path（PITFALLS §1.1：
  // 圆角走 50%/比例这类安全值，不用 999px 式巨大值）
  const shapeStyle = shape.kind === 10 ? { borderRadius: "50%" }
    : shape.kind === 0 || shape.kind === 9 ? { borderRadius: size * shape.corner }
    : { clipPath: `path("${polygonPath(shape.kind, size, shape.corner)}")` };
  return (
    <span
      className={`agent-orb${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        ...shapeStyle,
        background: `linear-gradient(135deg, ${a}, ${b})`,
      }}
    />
  );
}
