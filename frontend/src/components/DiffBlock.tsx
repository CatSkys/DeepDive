import { useMemo, useState } from "react";
import { IconCheckOutline16, IconCopyOutline16 } from "./Icons";
import { buildDiffRows, diffCopyText } from "../diffModel";
import { t, tt } from "../i18n";
import type { FileDiff } from "../types";

// DiffBlock：文件变更内联差异面（官方 ui-primitives DiffBlock 移植）。
// 每行 kind 上色（del 红/add 绿/path·gap 弱化），超长头尾折叠，一键复制。

const MAX_LINES = 16;

export function DiffBlock({ diffs }: { diffs: FileDiff[] }) {
  const { rows, added, removed, files } = useMemo(() => buildDiffRows(diffs), [diffs]);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  if (rows.length === 0) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(diffCopyText(rows));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1000);
    } catch { /* clipboard may be unavailable */ }
  };
  const hidden = rows.length - MAX_LINES;
  const capped = hidden > 0 && !expanded;
  const headLines = Math.ceil(MAX_LINES / 2);
  const tailLines = MAX_LINES - headLines;
  const head = capped ? rows.slice(0, headLines) : rows;
  const tail = capped ? rows.slice(rows.length - tailLines) : [];
  return (
    <div className="diff-block" data-diff="">
      <div className="diff-toolbar">
        <span className="diff-stats">
          {files} {files > 1 ? "files" : "file"} · <span className="diff-add">+{added}</span>{" "}
          <span className="diff-del">−{removed}</span>
        </span>
        <button type="button" className="diff-copy" onClick={() => void copy()}>
          {copied ? <IconCheckOutline16 size={13} /> : <IconCopyOutline16 size={13} />}
          {copied ? t("复制成功") : t("复制")}
        </button>
      </div>
      <div className="diff-body">
        {head.map((row, i) => (
          <div key={i} className={`diff-line ${row.kind}`}>{row.text}</div>
        ))}
        {hidden > 0 && (
          <button type="button" className="diff-expand" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded ? t("收起") : tt("… 其余 {n} 行", "… {n} more lines", { n: hidden })}
          </button>
        )}
        {tail.map((row, i) => (
          <div key={i} className={`diff-line ${row.kind}`}>{row.text}</div>
        ))}
      </div>
    </div>
  );
}
