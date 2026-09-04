import { memo, useState, type ReactNode } from "react";
import { IconCodeOutline16 } from "./Icons";
import { Lightbox } from "./Lightbox";
import { sendToShell } from "../host";
import { t } from "../i18n";
import katex from "katex";
import "katex/dist/katex.min.css";

// Lightweight monochrome Markdown renderer (no deps): headings, paragraphs,
// ordered/unordered lists (task lists), quotes, fenced + inline code with
// highlight.js, bold/italic/strikethrough, links (shell opens), tables, images
// (click → Lightbox).

export interface Block {
  kind: "h1" | "h2" | "h3" | "p" | "ul" | "ol" | "quote" | "code" | "table" | "math";
  lines: string[];
  lang?: string;
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
    // 块级数学：$$ … $$（同行或跨行）；未闭合回退普通段落
    if (line.trim().startsWith("$$")) {
      const startLine = i;
      let tex = line.trim().slice(2);
      let closed = false;
      if (tex.endsWith("$$")) { tex = tex.slice(0, -2); closed = true; }
      i++;
      while (!closed && i < lines.length) {
        const closeIdx = lines[i].indexOf("$$");
        if (closeIdx >= 0) { tex += "\n" + lines[i].slice(0, closeIdx); closed = true; }
        else tex += "\n" + lines[i];
        i++;
      }
      if (closed) {
        blocks.push({ kind: "math", lines: [tex] });
        continue;
      }
      i = startLine;
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ kind: ("h" + h[1].length) as Block["kind"], lines: [h[2]] });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const start = i;
      while (i < lines.length && /^>\s?/.test(lines[i])) i++;
      blocks.push({ kind: "quote", lines: lines.slice(start, i).map((l) => l.replace(/^>\s?/, "")) });
      continue;
    }
    if (/^[-*]\s+/.test(line.trim())) {
      const start = i;
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) i++;
      blocks.push({ kind: "ul", lines: lines.slice(start, i).map((l) => l.trim().replace(/^[-*]\s+/, "")) });
      continue;
    }
    if (/^\d+[.)]\s+/.test(line.trim())) {
      const start = i;
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) i++;
      blocks.push({ kind: "ol", lines: lines.slice(start, i).map((l) => l.trim().replace(/^\d+[.)]\s+/, "")) });
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
    // paragraph continuation
    const start = i;
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,3})\s|^>[>\s]|^[-*]\s|^\d+[.)]\s|^```/.test(lines[i])) i++;
    blocks.push({ kind: "p", lines: lines.slice(start, i) });
  }
  return blocks;
}

/** 行内语法：粗体/斜体/删除线/行内代码/行内数学/链接/图片。链接经壳
 *  open-url 打开（WebKit 内网页面跳转会离开 SPA）；图片点击进 Lightbox。 */
export function inline(text: string, keyBase: string, onImage: (src: string, alt: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\n]+)\*|~~([^~\n]+)~~|\$([^$\n]+?)\$|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    const mm = m as RegExpExecArray;
    if (mm.index > last) out.push(text.slice(last, mm.index));
    const key = `${keyBase}-${k++}`;
    if (mm[2] !== undefined) out.push(<strong key={key}>{mm[2]}</strong>);
    else if (mm[3] !== undefined) out.push(<code key={key}>{mm[3]}</code>);
    else if (mm[4] !== undefined) out.push(<em key={key}>{mm[4]}</em>);
    else if (mm[5] !== undefined) out.push(<del key={key}>{mm[5]}</del>);
    else if (mm[6] !== undefined) {
      const tex = mm[6];
      out.push(
        <span key={key} className="md-math" dangerouslySetInnerHTML={{ __html: renderMath(tex, false) }} />,
      );
    }
    else if (mm[7] !== undefined) {
      // 图片：g7=alt、g8=src（AUD-021 修复——曾 src/alt 互换且 alt 取数学组）
      const src = mm[8]!;
      const alt = mm[7];
      out.push(
        <img
          key={key}
          className="md-img"
          src={src}
          alt={alt}
          loading="lazy"
          onClick={() => onImage(src, alt)}
        />,
      );
    } else if (mm[9] !== undefined) {
      // 链接：g9=label、g10=url（AUD-021 修复——曾条件写 mm[8] 对链接匹配
      // 恒假，匹配到的 [label](url) 整段被跳过，链接文本静默丢失）
      const label = mm[9];
      const url = mm[10]!;
      out.push(
        <a
          key={key}
          href={url}
          onClick={(e) => {
            e.preventDefault();
            openExternal(url);
          }}
        >{label}</a>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function openExternal(url: string): void {
  if (window.webkit?.messageHandlers?.deepdiveHost) sendToShell({ type: "open-url", url });
  else window.open(url, "_blank");
}

/** 任务列表行：- [ ] / - [x] 前缀（GitHub 语法），渲染为只读勾选行。 */
function taskOf(line: string): { done: boolean; text: string } | null {
  const m = /^\[( |x|X)\]\s+(.*)$/.exec(line);
  if (!m) return null;
  return { done: m[1] !== " ", text: m[2] };
}

// highlight.js：common 语言集同步高亮（流式增量友好）。逐行高亮——多行
// 语法（块注释/多行字符串）的续行不着色，但任何输入下都结构安全。
import hljs from "highlight.js/lib/common";

/** KaTeX 同步渲染；throwOnError:false 时坏 TeX 输出红色原文而非抛错。 */
function renderMath(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, { displayMode, throwOnError: false, strict: false });
}

function highlightLine(line: string, lang: string): string | null {
  if (!lang || !hljs.getLanguage(lang)) return null;
  try {
    return hljs.highlight(line, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return null; // illegible input: fall back to plain text
  }
}

/** 代码预览卡：头栏（语言 + 复制）+ 行号 gutter 代码体（官方代码块样式）。 */
function CodeBlock({ lines, lang, keyBase }: { lines: string[]; lang: string; keyBase: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <div className="cb">
      <div className="cbHead">
        <span className="cbFile">
          <IconCodeOutline16 size={15} className="cbIcon" />
          <span className="cbLang">{lang || "code"}</span>
        </span>
        <button className="cbCopy" onClick={() => void copy()}>{copied ? t("已复制") : t("复制")}</button>
      </div>
      <div className="cbBody">
        <div className="cbLines">
          {lines.map((l, j) => {
            const html = highlightLine(l, lang);
            return (
              <div className="cbRow" key={`${keyBase}-r${j}`}>
                <span className="cbLn">{j + 1}</span>
                {html !== null
                  ? <span className="cbCode hljs" dangerouslySetInnerHTML={{ __html: html }} />
                  : <span className="cbCode">{l === "" ? " " : l}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** memo：流式期间每条增量都会重渲整个消息列表 —— 未变化的文本
 *  （历史消息占绝大多数）直接跳过 parseBlocks + 全量 reconcile。 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const blocks = parseBlocks(text);
  const onImage = (src: string, alt: string) => setLightbox({ src, alt });
  return (
    <div className="md">
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.kind) {
          case "h1": return <h1 key={key}>{inline(b.lines[0], key, onImage)}</h1>;
          case "h2": return <h2 key={key}>{inline(b.lines[0], key, onImage)}</h2>;
          case "h3": return <h3 key={key}>{inline(b.lines[0], key, onImage)}</h3>;
          case "quote": return <blockquote key={key}>{b.lines.map((l, j) => <p key={j}>{inline(l, `${key}-${j}`, onImage)}</p>)}</blockquote>;
          case "ul": return (
            <ul key={key}>{b.lines.map((l, j) => {
              const task = taskOf(l);
              if (task) {
                return (
                  <li key={j} className={`md-task${task.done ? " done" : ""}`}>
                    <span className="md-task-mark" aria-hidden="true">{task.done ? "✓" : ""}</span>
                    <span>{inline(task.text, `${key}-${j}`, onImage)}</span>
                  </li>
                );
              }
              return <li key={j}>{inline(l, `${key}-${j}`, onImage)}</li>;
            })}</ul>
          );
          case "ol": return (
            <ol key={key}>{b.lines.map((l, j) => <li key={j}>{inline(l, `${key}-${j}`, onImage)}</li>)}</ol>
          );
          case "code": return <CodeBlock key={key} keyBase={key} lines={b.lines} lang={b.lang ?? ""} />;
          case "math": return <div key={key} className="md-math-block" dangerouslySetInnerHTML={{ __html: renderMath(b.lines[0] ?? "", true) }} />;
          case "table": {
            const header = (b.lines[0] ?? "").split("||").map((c) => c.trim());
            const rows = b.lines.slice(1).map((r) => r.split("|").map((c) => c.trim()).filter((c) => c !== ""));
            return (
              <table key={key}>
                <thead><tr>{header.map((c, j) => <th key={j}>{inline(c, `${key}-th${j}`, onImage)}</th>)}</tr></thead>
                <tbody>{rows.map((r, j) => (
                  <tr key={j}>{r.map((c, x) => <td key={x}>{inline(c, `${key}-${j}-${x}`, onImage)}</td>)}</tr>
                ))}</tbody>
              </table>
            );
          }
          default: return <p key={key}>{b.lines.map((l, j) => <span key={j} className={j > 0 ? "md-wrappable" : ""}>{j > 0 ? "\n" : ""}{inline(l, `${key}-${j}`, onImage)}</span>)}</p>;
        }
      })}
      {lightbox && <Lightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />}
    </div>
  );
});
