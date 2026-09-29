// diff 的一行：行号槽 + 高亮正文。行号槽按 add=新号 / ctx·del=旧号（GitHub
// unified 惯例，patchModel 已算好）。高亮复用 CodeLines 的 highlightLine
// ——同一份 hljs 缓存与降级，不另起一套。

import { highlightLine } from "../components/CodeLines";
import { t } from "../i18n";
import type { DiffLine } from "./patchModel";

export function DiffRow({ line, lang }: { line: DiffLine; lang: string }) {
  const html = highlightLine(line.text, lang);
  return (
    <div className="rv-line" data-kind={line.kind}>
      <span className="rv-num">{line.number}</span>
      {html !== null
        ? <span className="rv-code hljs" dangerouslySetInnerHTML={{ __html: html }} />
        : <span className="rv-code">{line.text === "" ? " " : line.text}</span>}
      {line.noNewline && <span className="rv-nonewline">{t("无结尾换行")}</span>}
    </div>
  );
}
