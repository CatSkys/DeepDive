// 富输出渲染不出来的统一回退：按代码卡显示原文 + 一行说明为什么没渲染。三个富输出块
// （图表 / 内联 SVG / 交互组件）共用它，避免各写一套"难看但看得见"的降级形态。
import { CodeBlock } from "../components/CodeBlock";

export function RichFallback({ lines, lang, note }: { lines: string[]; lang: string; note: string }) {
  return (
    <div className="md-rich-fallback">
      <CodeBlock lines={lines} lang={lang} />
      <p className="md-rich-note">{note}</p>
    </div>
  );
}
