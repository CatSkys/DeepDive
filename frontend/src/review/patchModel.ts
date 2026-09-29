// unified diff 的纯解析层：把壳侧给的 patch 原文摊成 hunk 与行，并算出该在
// 哪儿折起未改动行。数值照 zcode 的 @pierre/diffs 取（GitPane 用的就是它）：
// 折叠阈值 1（≥2 行未改动才折）与每次展开 100 行。只管算，不碰 React 与样式。

export type DiffLineKind = "ctx" | "add" | "del";

export interface DiffLine {
  kind: DiffLineKind;
  /** 去掉前缀字符后的正文。 */
  text: string;
  /** 行号槽：新增取新侧行号，上下文与删除取旧侧（GitHub unified 惯例）。 */
  number: number;
  /** 本行是该侧最后一行且原文件无结尾换行。 */
  noNewline: boolean;
}

export interface DiffHunk {
  /** `@@ -17,6 +17,7 @@` 原文（行尾空白已去）。 */
  header: string;
  lines: DiffLine[];
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

export interface FilePatch {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
}

/** ≥2 行未改动才折成一条；1 行上下文照常内联。 */
export const FOLD_THRESHOLD = 1;

/** 点一次展开多少行。 */
export const EXPAND_STEP = 100;

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** 解析 patch 原文。没有 `@@`（如只改了文件模式）返回 null —— 调用方据此
 *  当作"有改动但无内容可展"，而不是给一个空 diff 假装无事发生。 */
export function parsePatch(patch: string): FilePatch | null {
  const rows = patch.split("\n");
  let oldPath = "";
  let newPath = "";
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const row of rows) {
    const header = HUNK_HEADER.exec(row);
    if (header) {
      oldNo = Number(header[1]);
      newNo = Number(header[3]);
      current = {
        header: row.trimEnd(),
        lines: [],
        oldStart: oldNo,
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: newNo,
        newLines: header[4] === undefined ? 1 : Number(header[4]),
      };
      hunks.push(current);
      continue;
    }
    if (!current) {
      // 头部行只在第一个 @@ 之前认：hunk 内部一行「-- foo」被删掉后渲染成
      // `--- foo`，与文件头逐字节相同，放进来认就会吞掉这行并改坏路径
      if (row.startsWith("--- ")) oldPath = stripPrefix(row.slice(4));
      else if (row.startsWith("+++ ")) newPath = stripPrefix(row.slice(4));
      continue;
    }
    if (row.startsWith("\\")) {
      // 「\ No newline at end of file」修饰上一行，不占行号
      const last = current.lines[current.lines.length - 1];
      if (last) last.noNewline = true;
      continue;
    }
    const mark = row[0];
    if (mark === "+") current.lines.push({ kind: "add", text: row.slice(1), number: newNo++, noNewline: false });
    else if (mark === "-") current.lines.push({ kind: "del", text: row.slice(1), number: oldNo++, noNewline: false });
    else if (mark === " ") {
      // 上下文行新旧两侧都在：行号槽取旧侧，但**两侧计数器都得走**，
      // 少走新侧会让本 hunk 之后所有新增行的行号偏小。
      current.lines.push({ kind: "ctx", text: row.slice(1), number: oldNo++, noNewline: false });
      newNo += 1;
    }
    // 其余（头部残留、空尾行）不属于任何 hunk 的正文，忽略
  }
  return hunks.length > 0 ? { oldPath, newPath, hunks } : null;
}

/** 未跟踪文件没有 patch，壳侧给的是全文——每一行都是新增。 */
export function untrackedLines(content: string): DiffLine[] {
  const endsClean = content.endsWith("\n");
  const lines = contentLines(content).map((text, i) => ({ kind: "add" as const, text, number: i + 1, noNewline: false }));
  if (!endsClean && lines.length > 0) lines[lines.length - 1].noNewline = true;
  return lines;
}

/** 工作树全文按行切。结尾换行是终止符不算一行（与 diffModel.diffContentLines 同规则）。 */
export function contentLines(content: string): string[] {
  if (content === "") return [];
  return (content.endsWith("\n") ? content.slice(0, -1) : content).split("\n");
}

/** 折在第几个 hunk 之后。`shown` 是用户已展开的行数（0 = 全折）。 */
export interface FoldGap {
  afterHunk: number;
  lines: number;
  shown: number;
  /** 展开时从工作树全文第几行取（新侧，1 起）。 */
  fromNew: number;
}

/** hunk 之间的未改动行 = 下一个 hunk 的旧侧起点 −（上一个 hunk 的旧侧终点）。
 *  相邻或重叠时得 ≤0，不是折点。 */
export function foldGaps(hunks: DiffHunk[], expanded: Record<number, number>): FoldGap[] {
  const gaps: FoldGap[] = [];
  for (let i = 0; i < hunks.length - 1; i += 1) {
    const lines = hunks[i + 1].oldStart - (hunks[i].oldStart + hunks[i].oldLines);
    if (lines <= FOLD_THRESHOLD) continue;
    const shown = Math.min(Math.max(expanded[i] ?? 0, 0), lines);
    gaps.push({ afterHunk: i, lines, shown, fromNew: hunks[i].newStart + hunks[i].newLines });
  }
  return gaps;
}

/** 折段展开出来的上下文行：**patch 里根本没有这些正文**（hunk 只带 3 行上下文），
 *  只能从壳侧回传的工作树全文里按新侧行号切。全文比 patch 短时到头就停。 */
export function contextLines(content: string[], fromNew: number, shown: number): DiffLine[] {
  const out: DiffLine[] = [];
  for (let k = 0; k < shown; k += 1) {
    const text = content[fromNew - 1 + k];
    if (text === undefined) break;
    out.push({ kind: "ctx", text, number: fromNew + k, noNewline: false });
  }
  return out;
}

function stripPrefix(path: string): string {
  const p = path.trim();
  if (p === "/dev/null") return "";
  return p.replace(/^[ab]\//, "");
}
