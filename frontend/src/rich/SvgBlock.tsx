// 内联 SVG 围栏：消毒后直接进文档（同步、无依赖）。消毒口径见 sanitizeSvg——围栏里的
// SVG 是模型输出，内联进文档等于把它的 DOM 加进 SPA。
import { useMemo } from "react";
import { t } from "../i18n";
import { RICH_FENCE_MAX_CHARS, SVG_FENCE } from "./fences";
import { RichFallback } from "./RichFallback";
import { sanitizeSvg } from "./sanitizeSvg";

/**
 * 只有 viewBox、没写宽高的 SVG 在 CSS 里默认 `width:100%`——一枚小图标会被拉满整张卡。
 * 按 viewBox 补上自然尺寸，过宽的情况由样式里的 `max-width:100%` 兜住。作者写了尺寸
 * 就一切照旧（mermaid 产物自带 width="100%"，走的是另一条路径，不受这里影响）。
 */
export function withNaturalSize(svg: string): string {
  const root = /<svg([^>]*)>/i.exec(svg);
  if (!root) return svg;
  const attrs = root[1]!;
  if (/\swidth\s*=/i.test(attrs) || /\sheight\s*=/i.test(attrs)) return svg;
  const viewBox = /viewbox\s*=\s*"([^"]+)"/i.exec(attrs)?.[1]?.trim().split(/\s+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || viewBox.some((n) => !Number.isFinite(n))) return svg;
  const width = viewBox[2]!;
  const height = viewBox[3]!;
  if (width <= 0 || height <= 0) return svg;
  return svg.replace(/<svg/i, `<svg width="${width}" height="${height}"`);
}

export function SvgBlock({ source, unclosed }: { source: string; unclosed: boolean }) {
  const tooBig = source.length > RICH_FENCE_MAX_CHARS;
  const clean = useMemo(
    () => (tooBig || unclosed ? null : sanitizeSvg(source)),
    [source, tooBig, unclosed],
  );
  // 围栏还没写完：半截 SVG 必然消毒不出根，先显示"正在读取"而不是失败（实测：手写
  // 168 行 SVG 逐行到达时，中途一直弹"SVG 渲染失败"，写完才成图——纯噪音）
  if (unclosed) return <p className="md-rich-pending">{t("正在读取图形…")}</p>;
  if (clean === null) {
    return (
      <RichFallback
        lines={source.split("\n")}
        lang={SVG_FENCE}
        note={tooBig ? t("内容过大，已按源码显示") : t("SVG 渲染失败，已按源码显示")}
      />
    );
  }
  return <div className="md-rich-figure" dangerouslySetInnerHTML={{ __html: withNaturalSize(clean) }} />;
}
