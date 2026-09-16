// mermaid 围栏块：异步成图（mermaid 按需 import），渲染不出来就退回代码块显示源码。
// 流式期间尾块每次增量都换一份源码——250ms 去抖把连续增量并成一次渲染；已完成的块由
// Markdown 的元素缓存在更上一层拦住，根本走不到这里。
import { useEffect, useState } from "react";
import { t } from "../i18n";
import { useDarkTheme } from "./appTheme";
import { MERMAID_FENCE, RICH_FENCE_MAX_CHARS } from "./fences";
import { renderMermaid } from "./mermaidRender";
import { RichFallback } from "./RichFallback";

/** 流式增量合并窗：小于打字间隔的抖动都并进同一次渲染。 */
const DEBOUNCE_MS = 250;

export function MermaidBlock({ code, unclosed }: { code: string; /** 围栏还没闭合（流式期间）*/ unclosed: boolean }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // 明暗由块自己订阅：配色烘进 SVG，切换主题必须重新渲染一张（见 appTheme.ts）
  const dark = useDarkTheme();
  const tooBig = code.length > RICH_FENCE_MAX_CHARS;
  useEffect(() => {
    // 未闭合就别去渲染（半截 mermaid 必然失败，白烧一次渲染；闭合后 flag 翻转会自动重跑）
    if (tooBig || unclosed) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      renderMermaid(code, dark)
        .then((out) => { if (alive) { setSvg(out); setFailed(false); } })
        .catch(() => { if (alive) { setSvg(null); setFailed(true); } });
    }, DEBOUNCE_MS);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [code, dark, tooBig, unclosed]);
  // 围栏还没写完：先不渲染，也不报"渲染失败"（半截 mermaid 必然解析失败，报错是噪音）
  if (unclosed) return <p className="md-rich-pending">{t("正在渲染图表…")}</p>;
  if (tooBig || failed) {
    return (
      <RichFallback
        lines={code.split("\n")}
        lang={MERMAID_FENCE}
        note={tooBig ? t("内容过大，已按源码显示") : t("图表渲染失败，已按源码显示")}
      />
    );
  }
  if (svg === null) return <p className="md-rich-pending">{t("正在渲染图表…")}</p>;
  return <div className="md-rich-figure" dangerouslySetInnerHTML={{ __html: svg }} />;
}
