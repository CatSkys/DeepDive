// Markdown 行内层（从 components/Markdown.tsx 拆出）：粗体/斜体/行内代码/数学/
// 链接/图片的行内语法与裸 URL 识别；外链经壳 open-url 打开（只此一份）。
import type { ReactNode } from "react";
import katex from "katex";
import { openExternalUrl } from "../host";

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
  openExternalUrl(url);
}

/** KaTeX 同步渲染；throwOnError:false 时坏 TeX 输出红色原文而非抛错。 */
export function renderMath(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, { displayMode, throwOnError: false, strict: false });
}
