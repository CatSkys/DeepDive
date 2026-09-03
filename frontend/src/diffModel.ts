// Diff 卡的纯推导层：官方 ui-primitives DiffBlock 的 buildRows/copyText 移植
// （docs/DSH-WIRE.md §3.4）。只管把 FileDiff[] 摊平成行与统计；不管渲染。

import type { FileDiff } from "./types";

export interface DiffRow {
  kind: "path" | "del" | "add" | "gap";
  text: string;
}

export interface DiffRows {
  rows: DiffRow[];
  added: number;
  removed: number;
  files: number;
}

/** 摊平 hunks：每个新文件开 path 头行，同文件第二个 hunk 用 ⋯ 间隔行。 */
export function buildDiffRows(diffs: FileDiff[]): DiffRows {
  const rows: DiffRow[] = [];
  const paths = new Set<string>();
  let added = 0;
  let removed = 0;
  let prevPath: string | undefined;
  for (const diff of diffs) {
    paths.add(diff.path);
    if (diff.path !== prevPath) rows.push({ kind: "path", text: diff.path });
    else rows.push({ kind: "gap", text: "⋯" });
    prevPath = diff.path;
    if (diff.oldText !== null) {
      for (const line of diffContentLines(diff.oldText)) {
        rows.push({ kind: "del", text: line });
        removed++;
      }
    }
    for (const line of diffContentLines(diff.newText)) {
      rows.push({ kind: "add", text: line });
      added++;
    }
  }
  return { rows, added, removed, files: paths.size };
}

/** 空串为零行；单个结尾换行是终止符而非空行（与 TerminalBlock 同规则）。 */
function diffContentLines(text: string): string[] {
  if (text === "") return [];
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.split("\n");
}

/** 复制用纯文本：-/+ 前缀行 + path 头，与卡片所见一致。 */
export function diffCopyText(rows: DiffRow[]): string {
  return rows
    .map((row) => {
      if (row.kind === "del") return `- ${row.text}`;
      if (row.kind === "add") return `+ ${row.text}`;
      return row.text;
    })
    .join("\n");
}

/** wire 侧收窄：card:'diff' 视图的 diffs 必须整列良构才可用（官方 narrowDiffs）。 */
export function narrowDiffs(diffs: unknown): FileDiff[] | null {
  if (!Array.isArray(diffs) || diffs.length === 0) return null;
  const out: FileDiff[] = [];
  for (const hunk of diffs) {
    if (typeof hunk !== "object" || hunk === null) return null;
    const { path, oldText, newText } = hunk as Record<string, unknown>;
    if (typeof path !== "string") return null;
    if (oldText !== null && typeof oldText !== "string") return null;
    if (typeof newText !== "string") return null;
    out.push({ path, oldText, newText });
  }
  return out;
}
