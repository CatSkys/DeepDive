// 行号代码体：Markdown 代码卡（Markdown.tsx 的 CodeBlock）与预览「代码/纯文本」
// 渲染器共用——同一套 cbLines/cbRow/cbLn/cbCode 栅格与逐行高亮，避免第二份实现。
// lang 为空即纯文本（不着色）；target 指定要高亮的行号（预览跳行用）。
// 逐行同步高亮：多行语法（块注释/多行字符串）的续行不着色，但任何输入下结构
// 安全（同 Markdown 的既有取舍）。
// 审查面板的 diff 行也从这里取高亮（review/DiffRow.tsx）：缓存与降级只此一份。

import hljs from "highlight.js/lib/common";

// 逐行高亮对 (语言, 行内容) 是纯函数：按内容记忆化。流式期间尾块每帧重渲，已输出
// 的行直接命中缓存，只有新来的行真正跑 hljs（实测 60 行代码块逐增量 1.7ms → 命中后
// 只剩新行的代价）。上限兜底：攒满整体丢弃重来，缓存不无限长。
const hlCache = new Map<string, string | null>();
const HL_CACHE_MAX = 2000;

/** 单行高亮；无该语言/输入不可解析时回 null（调用方渲染纯文本）。 */
export function highlightLine(line: string, lang: string): string | null {
  const key = `${lang}\u0000${line}`;
  const hit = hlCache.get(key);
  if (hit !== undefined) return hit;
  let out: string | null;
  if (!lang || !hljs.getLanguage(lang)) out = null;
  else {
    try {
      out = hljs.highlight(line, { language: lang, ignoreIllegals: true }).value;
    } catch {
      out = null; // illegible input: fall back to plain text
    }
  }
  if (hlCache.size >= HL_CACHE_MAX) hlCache.clear();
  hlCache.set(key, out);
  return out;
}

export function CodeLines({ lines, lang, target }: {
  lines: string[];
  /** hljs 语言 id；空串 = 纯文本。 */
  lang: string;
  /** 要高亮的行号（1 起）；未命中不高亮。 */
  target?: number;
}) {
  return (
    <div className="cbLines">
      {lines.map((line, i) => {
        const html = highlightLine(line, lang);
        return (
          <div className="cbRow" key={i} data-target={i + 1 === target ? "" : undefined}>
            <span className="cbLn">{i + 1}</span>
            {html !== null
              ? <span className="cbCode hljs" dangerouslySetInnerHTML={{ __html: html }} />
              : <span className="cbCode">{line === "" ? " " : line}</span>}
          </div>
        );
      })}
    </div>
  );
}
