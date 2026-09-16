// CSS 颜色解析与合成（纯函数，无 DOM）：给"要把颜色烘进产物"的渲染用。
//
// 为什么需要它：同一个语义变量的 getComputedStyle 值**随引擎而变**——Chrome 把
// theme.css 里写的 `rgba(24,24,27,.92)` 序列化成 8 位 hex `#18181beb`，WebKit 原样
// 返回 `rgba(24,24,27,.92)`。所以解析要同时吃 hex3/4/6/8 与 rgb()/rgba()（含现代的
// `rgb(24 24 27 / .92)` 写法），而不是只认一种。认不出来返回 null，由调用方决定是
// 抛错还是降级——这里不做任何默认值兜底。

/** 解析成 [r, g, b, a]（通道 0-255、alpha 0-1）；不是颜色返回 null。 */
export function parseCssColor(value: string): [number, number, number, number] | null {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (hex) {
    const h = hex[1]!;
    const pair = (s: string) => Number.parseInt(s, 16);
    const single = (ch: string) => pair(ch + ch);
    if (h.length === 3 || h.length === 4) {
      return [
        single(h[0]!), single(h[1]!), single(h[2]!),
        h.length === 4 ? single(h[3]!) / 255 : 1,
      ];
    }
    if (h.length === 6 || h.length === 8) {
      return [
        pair(h.slice(0, 2)), pair(h.slice(2, 4)), pair(h.slice(4, 6)),
        h.length === 8 ? pair(h.slice(6, 8)) / 255 : 1,
      ];
    }
    return null;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/i.exec(v);
  if (!rgb) return null;
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
}

/** 把半透明前景垫在不透明背景上合成实色，返回 `#rrggbb`——烘进 SVG 的颜色
 *  进不去 alpha。 */
export function compositeOver(
  fg: [number, number, number, number],
  bg: [number, number, number],
): string {
  const [r, g, b, a] = fg;
  return toHex(r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a));
}

export function toHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b]
    .map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0"))
    .join("");
}
