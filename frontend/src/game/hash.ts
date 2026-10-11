// 游戏系的确定性哈希原子：同一 (i, seed) 恒出同一 [0,1) 值——地形/棋盘生成、
// 回放测试都从这一枚来（两个游戏共用，勿在各自 world 里再写第二份）。
export function hash01(i: number, seed: number): number {
  const h = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
