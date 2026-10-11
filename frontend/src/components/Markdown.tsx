import { Fragment, memo, useRef, useState, type ReactNode } from "react";
import { Lightbox } from "./Lightbox";
import { CodeBlock } from "./CodeBlock";
import { AutomationProposalCard } from "../automation/AutomationProposalCard";
import { parseProposal, PROPOSAL_LANG } from "../automation/protocol";
import { MERMAID_FENCE, SVG_FENCE, WIDGET_FENCE, UI_FENCE, EMBED_FENCE } from "../rich/fences";
import { MermaidBlock } from "../rich/MermaidBlock";
import { SvgBlock } from "../rich/SvgBlock";
import { WidgetBlock } from "../rich/WidgetBlock";
import { EmbedBlock } from "../rich/EmbedBlock";
import { UiBlock } from "../rich/ui/UiBlock";
import { parseBlocks, type Block } from "../markdown/blocks";
import { inline, renderMath } from "../markdown/inline";

// Lightweight monochrome Markdown renderer: headings, paragraphs,
// ordered/unordered lists (task lists), quotes, fenced + inline code with
// highlight.js, bold/italic/strikethrough, links (shell opens), tables, images
// (click → Lightbox). Four fence languages are handed off instead of shown as
// code — the npm-style proposal block and the rich-output set
// (mermaid / svg / widget, see src/rich/); everything else stays a code block.
// 语法块切分与行内语法的纯函数在 src/markdown/（本文件只管渲染）；对外导出
// 保持原样（测试与调用方不必改导入）。

/** 任务列表行：- [ ] / - [x] 前缀（GitHub 语法），渲染为只读勾选行。 */
function taskOf(line: string): { done: boolean; text: string } | null {
  const m = /^\[( |x|X)\]\s+(.*)$/.exec(line);
  if (!m) return null;
  return { done: m[1] !== " ", text: m[2] };
}

/** 单个块 → React 元素（不含 key：块级缓存复用同一个元素对象，key 由调用方的
 *  Fragment 按位置给）。 */
function renderBlock(b: Block, key: string, onImage: (src: string, alt: string) => void, onOpenFile?: (path: string, line?: number) => void, onSend?: (text: string) => void): ReactNode {
  const open = (line: string, k: string) => inline(line, k, onImage, onOpenFile);
  switch (b.kind) {
          case "h1": return <h1 key={key}>{open(b.lines[0], key)}</h1>;
          case "h2": return <h2 key={key}>{open(b.lines[0], key)}</h2>;
          case "h3": return <h3 key={key}>{open(b.lines[0], key)}</h3>;
          case "quote": return <blockquote key={key}>{b.lines.map((l, j) => <p key={j}>{open(l, `${key}-${j}`)}</p>)}</blockquote>;
          case "ul": return (
            <ul key={key}>{b.lines.map((l, j) => {
              const task = taskOf(l);
              if (task) {
                return (
                  <li key={j} className={`md-task${task.done ? " done" : ""}`}>
                    <span className="md-task-mark" aria-hidden="true">{task.done ? "✓" : ""}</span>
                    <span>{open(task.text, `${key}-${j}`)}</span>
                  </li>
                );
              }
              return <li key={j}>{open(l, `${key}-${j}`)}</li>;
            })}</ul>
          );
          case "ol": return (
            <ol key={key}>{b.lines.map((l, j) => <li key={j}>{open(l, `${key}-${j}`)}</li>)}</ol>
          );
          case "code": {
            // automation 围栏块 = 模型提出的定时任务建议；解析不了就当普通代码块
            const proposal = b.lang === PROPOSAL_LANG ? parseProposal(b.lines.join("\n")) : null;
            if (proposal !== null) return <AutomationProposalCard key={key} proposal={proposal} />;
            // 富输出围栏（词表见 rich/fences.ts）：图表 / 内联 SVG / 交互组件；各自的
            // 渲染不出来都退回代码块显示原文，不吞掉内容
            const body = b.lines.join("\n");
            if (b.lang === MERMAID_FENCE) return <MermaidBlock key={key} code={body} unclosed={b.unclosed === true} />;
            if (b.lang === SVG_FENCE) return <SvgBlock key={key} source={body} unclosed={b.unclosed === true} />;
            if (b.lang === WIDGET_FENCE) return <WidgetBlock key={key} html={body} unclosed={b.unclosed === true} onSend={onSend} />;
            if (b.lang === UI_FENCE) return <UiBlock key={key} body={body} unclosed={b.unclosed === true} onSend={onSend} />;
            if (b.lang === EMBED_FENCE) return <EmbedBlock key={key} url={body} unclosed={b.unclosed === true} />;
            return <CodeBlock key={key} lines={b.lines} lang={b.lang ?? ""} />;
          }
          case "math": return <div key={key} className="md-math-block" dangerouslySetInnerHTML={{ __html: renderMath(b.lines[0] ?? "", true) }} />;
          case "table": {
            const header = (b.lines[0] ?? "").split("||").map((c) => c.trim());
            const rows = b.lines.slice(1).map((r) => r.split("|").map((c) => c.trim()).filter((c) => c !== ""));
            return (
              <table key={key}>
                <thead><tr>{header.map((c, j) => <th key={j}>{open(c, `${key}-th${j}`)}</th>)}</tr></thead>
                <tbody>{rows.map((r, j) => (
                  <tr key={j}>{r.map((c, x) => <td key={x}>{open(c, `${key}-${j}-${x}`)}</td>)}</tr>
                ))}</tbody>
              </table>
            );
          }
    default: return <p key={key}>{b.lines.map((l, j) => <span key={j} className={j > 0 ? "md-wrappable" : ""}>{j > 0 ? "\n" : ""}{open(l, `${key}-${j}`)}</span>)}</p>;
  }
}

/** memo：流式期间每条增量都会重渲整个消息列表 —— 未变化的文本
 *  （历史消息占绝大多数）直接跳过 parseBlocks + 全量 reconcile。 */
export const Markdown = memo(function Markdown({ text, onOpenFile, onSend }: {
  text: string;
  /** 本地文件链接的落点（预览窗口打开/跳行）；不传则链接按外链处理。 */
  onOpenFile?: (path: string, line?: number) => void;
  /** `ui` 围栏动作按钮的落点（交互文本作为用户下一轮发出）；不传则按钮不动作。 */
  onSend?: (text: string) => void;
}) {
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  // 回调经 ref 转发：块级缓存会复用上次建的元素，闭包若焊死建元素那刻的 props
  // 就会拿着过期的 onOpenFile（SessionView 传的是内联箭头，每渲染换身份）。
  const cb = useRef({ onOpenFile, onSend });
  cb.current.onOpenFile = onOpenFile;
  cb.current.onSend = onSend;
  const handlers = useRef({
    image: (src: string, alt: string) => setLightbox({ src, alt }),
    openFile: (path: string, line?: number) => cb.current.onOpenFile?.(path, line),
    send: (text: string) => cb.current.onSend?.(text),
  }).current;
  // 块级元素缓存（官方 incremental 渲染的「块冻结」纪律，落在 React 元素这一层：
  // 流式期间只有正在增长的那个尾块内容在变）。键是**块的位置**：输入严格追加
  // （切会话/落定/重建都是新的 Markdown 实例，text 只从这一个组件流进来增长），
  // parseBlocks 又是确定性的左到右扫描——非尾块的行序一旦排定便冻结，命中时只需
  // 校验 kind/lang/unclosed/行数/末行，不再落 O(len) 的全量 join；尾块（增长中的
  // 一段）每版重解析重渲染。highlight.js、KaTeX、行内解析对非尾块全部零成本
  // （实测 8.5KB 消息逐增量重渲 6.8ms → 命中后 <1ms）。
  const cache = useRef(new Map<number, { node: ReactNode; shape: string; lineCount: number; tail: string }>());
  const blocks = parseBlocks(text);
  const lastIdx = blocks.length - 1;
  return (
    <div className="md">
      {blocks.map((b, i) => {
        if (i < lastIdx) {
          const keep = cache.current.get(i);
          const shape = `${b.kind}\u0000${b.lang ?? ""}\u0000${b.unclosed ? "unclosed" : "closed"}`;
          if (keep && keep.shape === shape && keep.lineCount === b.lines.length && keep.tail === b.lines[b.lines.length - 1]) {
            return <Fragment key={`b${i}`}>{keep.node}</Fragment>;
          }
        }
        const node = renderBlock(b, `b${i}`, handlers.image, handlers.openFile, handlers.send);
        if (i < lastIdx) {
          // 上限兜底：实例内极少积累（一条消息几个块），超限整体丢弃重来
          if (cache.current.size >= 512) cache.current.clear();
          cache.current.set(i, { node, shape: `${b.kind}\u0000${b.lang ?? ""}\u0000${b.unclosed ? "unclosed" : "closed"}`, lineCount: b.lines.length, tail: b.lines[b.lines.length - 1] ?? "" });
        }
        return <Fragment key={`b${i}`}>{node}</Fragment>;
      })}
      {lightbox && <Lightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />}
    </div>
  );
});

/** 对外导出保留在 Markdown（调用方与测试的导入点不变）。 */
export { parseBlocks } from "../markdown/blocks";
export { inline, localFileTarget } from "../markdown/inline";
