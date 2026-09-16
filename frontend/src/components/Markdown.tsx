import { Fragment, memo, useRef, useState, type ReactNode } from "react";
import { Lightbox } from "./Lightbox";
import { CodeBlock } from "./CodeBlock";
import { sendToShell } from "../host";
import { AutomationProposalCard } from "../automation/AutomationProposalCard";
import { parseProposal, PROPOSAL_LANG } from "../automation/protocol";
import { LESSON_LANG, parseLesson } from "../evolution/protocol";
import { MERMAID_FENCE, SVG_FENCE, WIDGET_FENCE } from "../rich/fences";
import { MermaidBlock } from "../rich/MermaidBlock";
import { SvgBlock } from "../rich/SvgBlock";
import { WidgetBlock } from "../rich/WidgetBlock";
import katex from "katex";
import "katex/dist/katex.min.css";

// Lightweight monochrome Markdown renderer: headings, paragraphs,
// ordered/unordered lists (task lists), quotes, fenced + inline code with
// highlight.js, bold/italic/strikethrough, links (shell opens), tables, images
// (click → Lightbox). Three fence languages are handed off instead of shown as
// code — npm-style proposal/lesson blocks and the rich-output set
// (mermaid / svg / widget, see src/rich/); everything else stays a code block.

export interface Block {
  kind: "h1" | "h2" | "h3" | "p" | "ul" | "ol" | "quote" | "code" | "table" | "math";
  lines: string[];
  lang?: string;
}

// 块首判定：分支与段落续行的测试必须用**同一套谓词**，否则会出现「分支都不认、续行
// 又认为该停」的零前进行（2026-09-16 事故：流式期间模型刚打出 "- " 内容还没到，主
// 线程在 parseBlocks 里空转，界面直接卡死）。列表标记允许空内容（`(\s+|$)`），这正是
// 流式瞬态要渲染的形态：先出现一个空项目，文字随后填进来。
const RE_FENCE_OPEN = /^```/;
// 带内容捕获组：谓词与取文本共用同一条正则（尾组 (.*)$ 恒匹配，测试等价于前缀判定）
const RE_HEADING = /^(#{1,3})\s+(.*)$/;
const RE_QUOTE = /^>\s?/;
const RE_BULLET = /^[-*](\s+|$)/;
const RE_ORDERED = /^\d+[.)](\s+|$)/;

/** 该行是否开启一个新块（同一条判据给分支与续行共用）。 */
function startsBlock(line: string): boolean {
  const t = line.trim();
  return RE_FENCE_OPEN.test(t) || RE_BULLET.test(t) || RE_ORDERED.test(t)
    || RE_HEADING.test(line) || RE_QUOTE.test(line);
}

export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }
    const fence = /^```([A-Za-z0-9_+#.-]*)\s*$/.exec(line.trim());
    if (fence) {
      const start = i + 1;
      let end = lines.length;
      for (let j = start; j < lines.length; j++) {
        if (/^```\s*$/.test(lines[j].trim())) { end = j; break; }
      }
      const body = lines.slice(start, end);
      if (body.length > 0 || (fence[1] ?? "") !== "") {
        blocks.push({ kind: "code", lines: body, lang: fence[1] ?? "" });
      }
      i = end + 1;
      continue;
    }
    // 块级数学：$$ … $$（同行或跨行）。未闭合**不消费本行**——游标只前进、绝不回卷：
    // 回卷写法（i = startLine; continue）会让同一行反复命中本分支。流式期间模型刚
    // 打出 "$$" 而闭合还没到时必然踩到，正是卡死事故的另一半根因。
    if (line.trim().startsWith("$$")) {
      let tex = line.trim().slice(2);
      let closed = tex.endsWith("$$");
      if (closed) tex = tex.slice(0, -2);
      let j = i + 1;
      while (!closed && j < lines.length) {
        const closeIdx = lines[j].indexOf("$$");
        if (closeIdx >= 0) { tex += "\n" + lines[j].slice(0, closeIdx); closed = true; }
        else tex += "\n" + lines[j];
        j++;
      }
      if (closed) {
        blocks.push({ kind: "math", lines: [tex] });
        i = j;
        continue;
      }
      // 未闭合：落到下面的段落分支按字面渲染（闭合到达后自然变成公式）
    }
    const h = RE_HEADING.exec(line);
    if (h) {
      blocks.push({ kind: ("h" + h[1].length) as Block["kind"], lines: [h[2]] });
      i++;
      continue;
    }
    if (RE_QUOTE.test(line)) {
      const start = i;
      while (i < lines.length && RE_QUOTE.test(lines[i])) i++;
      blocks.push({ kind: "quote", lines: lines.slice(start, i).map((l) => l.replace(/^>\s?/, "")) });
      continue;
    }
    if (RE_BULLET.test(line.trim())) {
      const start = i;
      while (i < lines.length && RE_BULLET.test(lines[i].trim())) i++;
      blocks.push({ kind: "ul", lines: lines.slice(start, i).map((l) => l.trim().replace(/^[-*]\s*/, "")) });
      continue;
    }
    if (RE_ORDERED.test(line.trim())) {
      const start = i;
      while (i < lines.length && RE_ORDERED.test(lines[i].trim())) i++;
      blocks.push({ kind: "ol", lines: lines.slice(start, i).map((l) => l.trim().replace(/^\d+[.)]\s*/, "")) });
      continue;
    }
    // table: header row + separator row of |---|
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const header = line.split("|").map((c) => c.trim()).filter((c) => c !== "");
      i += 2; // 跳过表头与分隔行：分隔行曾混进数据行，渲染出一排短横线单元格
      const rows: string[] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(...[lines[i]]);
        i++;
      }
      blocks.push({ kind: "table", lines: [header.join("||"), ...rows] });
      continue;
    }
    // 段落：先吃掉本行再吃续行 —— i 必须严格前进（上面任何分支漏判一行时，
    // 这里兜住零前进，最坏只是多一个单行段落，不会卡住界面）
    const start = i;
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !startsBlock(lines[i])) i++;
    blocks.push({ kind: "p", lines: lines.slice(start, i) });
  }
  return blocks;
}

/** 链接节点：外链经壳 open-url 打开（WebKit 内网页面跳转会离开 SPA）；本地
 *  文件路径交预览并落到行号，没有落点回调时退回外链行为。markdown 链接、
 *  加粗里的链接、正文裸 URL 三条来源共用它，点击行为只此一份。 */
function linkEl(url: string, label: ReactNode, key: string, onOpenFile?: (path: string, line?: number) => void): ReactNode {
  const local = onOpenFile ? localFileTarget(url) : null;
  return (
    <a
      key={key}
      href={url}
      onClick={(e) => {
        e.preventDefault();
        if (local) onOpenFile!(local.path, local.line);
        else openExternal(url);
      }}
    >{label}</a>
  );
}

/** 句末标点：URL 后面的「。」「,」「)」是句子的不是地址的。只在没有配对左括号
 *  时才砍右括号（维基式带括号的地址要保住）。 */
function trimUrlTail(raw: string): string {
  const url = raw.replace(/[.,;:!?、。，；：！？'"”’]+$/, "");
  return url.endsWith(")") && !url.includes("(") ? url.slice(0, -1) : url;
}

/** 把纯文本里的裸 URL 挑出来成链接（模型常直接把链接写进正文，本渲染器没接
 *  CommonMark 的 autolink，不挑就只是死文本）。 */
function linkify(text: string, keyBase: string, onOpenFile?: (path: string, line?: number) => void): ReactNode[] {
  // 全角标点与空白不进 URL：中文正文里链接后面紧跟「。」是常态
  const re = /https?:\/\/[^\s<>"'\u3000-\u303f\uff00-\uffef]+/g;
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const url = trimUrlTail(m[0]);
    if (!url) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(linkEl(url, url, `${keyBase}-u${k++}`, onOpenFile));
    last = m.index + url.length;
    re.lastIndex = last; // 被裁掉的句末标点留给下一段纯文本
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** 加粗内容里的裸 URL 成链；没有 URL 时原样返回字符串（children 形状不变）。 */
function linkified(text: string, keyBase: string, onOpenFile?: (path: string, line?: number) => void): ReactNode {
  const nodes = linkify(text, keyBase, onOpenFile);
  return nodes.length === 1 && typeof nodes[0] === "string" ? nodes[0] : nodes;
}

/** 行内语法：粗体/斜体/删除线/行内代码/行内数学/链接/图片。链接经壳
 *  open-url 打开（WebKit 内网页面跳转会离开 SPA）；图片点击进 Lightbox。 */
export function inline(text: string, keyBase: string, onImage: (src: string, alt: string) => void, onOpenFile?: (path: string, line?: number) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\n]+)\*|~~([^~\n]+)~~|\$([^$\n]+?)\$|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(...linkify(text.slice(last, m.index), `${keyBase}-t${k}`, onOpenFile));
    const key = `${keyBase}-${k++}`;
    if (m[2] !== undefined) out.push(<strong key={key}>{linkified(m[2], key, onOpenFile)}</strong>);
    else if (m[3] !== undefined) out.push(<code key={key}>{m[3]}</code>);
    else if (m[4] !== undefined) out.push(<em key={key}>{m[4]}</em>);
    else if (m[5] !== undefined) out.push(<del key={key}>{m[5]}</del>);
    else if (m[6] !== undefined) {
      const tex = m[6];
      out.push(
        <span key={key} className="md-math" dangerouslySetInnerHTML={{ __html: renderMath(tex, false) }} />,
      );
    }
    else if (m[7] !== undefined) {
      // 图片：g7=alt、g8=src（AUD-021 修复——曾 src/alt 互换且 alt 取数学组）
      const src = m[8]!;
      const alt = m[7];
      // 0.1.5 本地绝对路径图（工作区外截图等）：单斜杠开头重写到引擎
      // /api/file 面（同源经桥，路径在查询串）；http(s)/相对路径原样。
      const imgSrc = src.startsWith("/") && !src.startsWith("//") && !src.startsWith("/api/")
        ? `/api/file?path=${encodeURIComponent(src)}`
        : src;
      out.push(
        <img
          key={key}
          className="md-img"
          src={imgSrc}
          alt={alt}
          loading="lazy"
          onClick={() => onImage(imgSrc, alt)}
        />,
      );
    } else if (m[9] !== undefined) {
      // 链接：g9=label、g10=url（AUD-021 修复——曾条件写 mm[8] 对链接匹配
      // 恒假，匹配到的 [label](url) 整段被跳过，链接文本静默丢失）
      const label = m[9];
      out.push(linkEl(m[10]!, label, key, onOpenFile));
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(...linkify(text.slice(last), `${keyBase}-t${k}`, onOpenFile));
  return out;
}

/** 本地文件链接 → 预览目标（相对/绝对路径，可选 `:行号`）。
 *  只认"看着像文件路径"的：带 `/`，或后缀像扩展名；外链/锚点/纯词不认。 */
export function localFileTarget(url: string): { path: string; line?: number } | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//") || url.startsWith("#")) return null;
  const m = /^(.+?)(?::(\d+))?$/.exec(url);
  if (!m) return null;
  const path = m[1]!;
  if (!path.includes("/") && !/\.[a-z0-9]{1,8}$/i.test(path)) return null;
  const line = m[2] === undefined ? undefined : Number(m[2]);
  return line !== undefined && line > 0 ? { path, line } : { path };
}

function openExternal(url: string): void {
  // 只放行安全 scheme：javascript:/data: 等一旦经壳 open-url 或新窗口打开即是执行面
  if (!/^(https?|file|mailto):/i.test(url)) return;
  if (window.webkit?.messageHandlers?.deepdiveHost) sendToShell({ type: "open-url", url });
  else window.open(url, "_blank");
}

/** 任务列表行：- [ ] / - [x] 前缀（GitHub 语法），渲染为只读勾选行。 */
function taskOf(line: string): { done: boolean; text: string } | null {
  const m = /^\[( |x|X)\]\s+(.*)$/.exec(line);
  if (!m) return null;
  return { done: m[1] !== " ", text: m[2] };
}

/** KaTeX 同步渲染；throwOnError:false 时坏 TeX 输出红色原文而非抛错。 */
function renderMath(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, { displayMode, throwOnError: false, strict: false });
}

/** 单个块 → React 元素（不含 key：块级缓存复用同一个元素对象，key 由调用方的
 *  Fragment 按位置给）。 */
function renderBlock(b: Block, key: string, onImage: (src: string, alt: string) => void, onOpenFile?: (path: string, line?: number) => void): ReactNode {
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
            // lesson 块 = 自进化提案：采集端已收进设置里的队列，会话里**零 UI**（SPEC §8）；
            // 只有形状不合法时才退回普通代码块，让"模型没按格式写"看得见
            if (b.lang === LESSON_LANG && parseLesson(b.lines.join("\n")) !== null) return null;
            // 富输出围栏（词表见 rich/fences.ts）：图表 / 内联 SVG / 交互组件；各自的
            // 渲染不出来都退回代码块显示原文，不吞掉内容
            const body = b.lines.join("\n");
            if (b.lang === MERMAID_FENCE) return <MermaidBlock key={key} code={body} />;
            if (b.lang === SVG_FENCE) return <SvgBlock key={key} source={body} />;
            if (b.lang === WIDGET_FENCE) return <WidgetBlock key={key} html={body} />;
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
export const Markdown = memo(function Markdown({ text, onOpenFile }: {
  text: string;
  /** 本地文件链接的落点（预览窗口打开/跳行）；不传则链接按外链处理。 */
  onOpenFile?: (path: string, line?: number) => void;
}) {
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  // 回调经 ref 转发：块级缓存会复用上次建的元素，闭包若焊死建元素那刻的 props
  // 就会拿着过期的 onOpenFile（SessionView 传的是内联箭头，每渲染换身份）。
  const cb = useRef({ onOpenFile });
  cb.current.onOpenFile = onOpenFile;
  const handlers = useRef({
    image: (src: string, alt: string) => setLightbox({ src, alt }),
    openFile: (path: string, line?: number) => cb.current.onOpenFile?.(path, line),
  }).current;
  // 块级元素缓存（官方 incremental 渲染的「块冻结」纪律，落在 React 元素这一层）：
  // 流式期间只有正在增长的那个尾块内容在变，已完成的块按「块内容签名」命中缓存，
  // 直接复用上次的元素对象——React 见元素引用不变即跳过整棵子树，highlight.js、
  // KaTeX、行内解析全部零成本（实测 8.5KB 消息逐增量重渲 6.8ms → 命中后 <1ms）。
  const cache = useRef(new Map<string, ReactNode>());
  const blocks = parseBlocks(text);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        const sig = `${b.kind}\u0000${b.lang ?? ""}\u0000${b.lines.join("\n")}`;
        let node = cache.current.get(sig);
        if (node === undefined) {
          node = renderBlock(b, `b${i}`, handlers.image, handlers.openFile);
          // 上限兜底：长流式消息每一版尾块都会新占一条，攒满即整体丢弃重来
          if (cache.current.size >= 300) cache.current.clear();
          cache.current.set(sig, node);
        }
        return <Fragment key={`b${i}`}>{node}</Fragment>;
      })}
      {lightbox && <Lightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />}
    </div>
  );
});
