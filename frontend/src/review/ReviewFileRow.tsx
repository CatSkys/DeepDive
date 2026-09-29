// 审查列表里的一个文件：头是「图标 + 路径 + 增删数 + 展开箭头」，展开后是它的
// diff（懒取，取回后 parsePatch 摊行）。展开与折叠展开量都是本组件的局部状态，
// 收起即丢——与预览面板的每标签视图偏好同一套取舍。

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { FileIcon } from "../session/FileIcon";
import { languageOf } from "../components/preview/previewModel";
import { t, tt } from "../i18n";
import type { ReviewChange, ReviewDiff } from "./types";
import { DiffRow } from "./DiffRow";
import {
  EXPAND_STEP,
  contentLines,
  contextLines,
  foldGaps,
  parsePatch,
  untrackedLines,
  type DiffHunk,
  type DiffLine,
  type FoldGap,
} from "./patchModel";

/** 壳侧的形态决定这里说哪句话；解析不出内容另给一句（不是静默的空 diff）。 */
function noteOf(diff: ReviewDiff, change: ReviewChange): string {
  switch (diff.kind) {
    case "binary": return change.binary ? t("二进制文件，未展开") : t("文件过大，未展开");
    case "truncated": return t("改动过大，未展开");
    case "unavailable": return t("取不到这份改动");
    default: return t("无内容差异");
  }
}

export function ReviewFileRow({ change, diff, fetching, revision, onRequest }: {
  change: ReviewChange;
  diff: ReviewDiff | undefined;
  fetching: boolean;
  /** 刷新轮次：进 effect 依赖，刷新后已展开的行会重新去取。 */
  revision: number;
  onRequest: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, number>>({});
  const lang = languageOf(change.path);

  useEffect(() => {
    if (open) onRequest();
  }, [open, onRequest, revision]);

  const parsed = useMemo(() => (diff?.kind === "patch" ? parsePatch(diff.patch) : null), [diff]);
  const current = useMemo(
    () => (diff && (diff.kind === "patch" || diff.kind === "untracked") ? contentLines(diff.content) : []),
    [diff],
  );
  const gaps = useMemo(() => (parsed ? foldGaps(parsed.hunks, expanded) : []), [parsed, expanded]);

  /** 再点一次按 EXPAND_STEP 递加，全开后归零（回到全折）。 */
  const more = (gap: FoldGap) => setExpanded((prev) => {
    const now = prev[gap.afterHunk] ?? 0;
    return { ...prev, [gap.afterHunk]: now >= gap.lines ? 0 : now + EXPAND_STEP };
  });

  const slash = change.path.lastIndexOf("/");
  const name = slash >= 0 ? change.path.slice(slash + 1) : change.path;
  const dir = slash >= 0 ? change.path.slice(0, slash + 1) : "";

  return (
    <section className="rv-file" data-open={open || undefined}>
      <button type="button" className="rv-file-head" aria-expanded={open} title={change.path}
        onClick={() => setOpen((v) => !v)}>
        <FileIcon file={name} />
        <span className="rv-file-name">{name}</span>
        {dir && <span className="rv-file-dir">{dir}</span>}
        <span className="rv-file-count">
          <b className="rv-add">+{change.added}</b>
          <b className="rv-del">−{change.removed}</b>
        </span>
        <ChevronDown size={14} className="rv-file-caret" />
      </button>

      {open && (
        <div className="rv-file-body">
          {!diff && (fetching ? <p className="rv-note">{t("载入中…")}</p> : null)}
          {diff?.kind === "untracked" && <Lines lines={untrackedLines(diff.content)} lang={lang} />}
          {diff && diff.kind !== "untracked" &&
            (parsed
              ? <Hunks hunks={parsed.hunks} gaps={gaps} current={current} lang={lang} more={more} />
              : <p className="rv-note">{noteOf(diff, change)}</p>)}
        </div>
      )}
    </section>
  );
}

/** hunk 逐段渲染，段与段之间按 gaps 插折叠条。取不到工作树全文时折叠条退化为
 *  一行纯标签（没有正文可展，给个能点的样子就是骗人了）。 */
function Hunks({ hunks, gaps, current, lang, more }: {
  hunks: DiffHunk[];
  gaps: FoldGap[];
  current: string[];
  lang: string;
  more: (gap: FoldGap) => void;
}) {
  return (
    <>
      {hunks.map((hunk, i) => {
        const gap = gaps.find((g) => g.afterHunk === i);
        return (
          <div key={hunk.header} className="rv-hunk">
            <Lines lines={hunk.lines} lang={lang} />
            {gap && (
              <Fold gap={gap} canExpand={current.length > 0} more={more} lines={contextLines(current, gap.fromNew, gap.shown)} lang={lang} />
            )}
          </div>
        );
      })}
    </>
  );
}

function Fold({ gap, canExpand, more, lines, lang }: {
  gap: FoldGap;
  canExpand: boolean;
  more: (gap: FoldGap) => void;
  lines: DiffLine[];
  lang: string;
}) {
  const label = gap.shown >= gap.lines
    ? t("收起")
    : tt("{n} 行未改动", "{n} unmodified lines", { n: gap.lines });
  return (
    <div className="rv-fold">
      {canExpand
        ? <button type="button" className="rv-fold-bar" onClick={() => more(gap)}>{label}</button>
        : <span className="rv-fold-bar" data-static="">{label}</span>}
      {lines.length > 0 && <Lines lines={lines} lang={lang} />}
    </div>
  );
}

function Lines({ lines, lang }: { lines: DiffLine[]; lang: string }) {
  return (
    <div className="rv-lines">
      {lines.map((line, i) => <DiffRow key={i} line={line} lang={lang} />)}
    </div>
  );
}
