// Markdown 语法层（从 components/Markdown.tsx 拆出）：可辨识块类型 + 左到右
// 确定性块切分。纯函数、不含渲染；渲染层在 components/Markdown.tsx。

export interface Block {
  kind: "h1" | "h2" | "h3" | "p" | "ul" | "ol" | "quote" | "code" | "table" | "math";
  lines: string[];
  lang?: string;
  /** 只在**围栏还没闭合**时出现（流式期间必然如此）。富输出块据此先不渲染：半截
   *  SVG/HTML 只会渲染失败，弹一句「渲染失败」再自己消失，是纯噪音（2026-09-16 实测：
   *  168 行的手写 SVG 逐行到达，中途一直显示「SVG 渲染失败」，写完才成图）。 */
  unclosed?: true;
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
      let closed = false;
      for (let j = start; j < lines.length; j++) {
        if (/^```\s*$/.test(lines[j].trim())) { end = j; closed = true; break; }
      }
      const body = lines.slice(start, end);
      if (body.length > 0 || (fence[1] ?? "") !== "") {
        blocks.push({ kind: "code", lines: body, lang: fence[1] ?? "", ...(closed ? {} : { unclosed: true as const }) });
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

