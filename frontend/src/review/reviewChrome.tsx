// 审查面占住预览面板 chrome 的那两件东西：文件面顶栏左端的「切到审查」钮，
// 与全屏时审查面的页头。放在 review/ 是因为它们只服务审查这一面——
// FilePreviewWindow 只需知道「审查面时换成这一套」，不必知道它长什么样
// （那份文件已经 287 行，见 docs/ARCHITECTURE.md §components/preview/）。

import { ChevronLeft, FileDiff } from "lucide-react";
import { t, tt } from "../i18n";

/** 文件面 → 审查面。 */
export function ReviewModeButton({ onReview }: { onReview: () => void }) {
  return (
    <button
      type="button"
      className="preview-review-btn"
      data-tip={tt("审查改动", "Review changes")}
      aria-label={tt("审查改动", "Review changes")}
      onClick={onReview}
    >
      <FileDiff size={14} />
    </button>
  );
}

/** 全屏审查面的页头：返回 + 标题。审查面没有文件名也没有「打开方式」可谈，
 *  所以右端是空的——与 .session-header 同一套几何。 */
export function ReviewPageHeader({ onBack }: { onBack: () => void }) {
  return (
    <div className="session-header preview-page-head">
      <div className="left">
        <div className="title-row">
          <button type="button" className="session-back" data-tip={t("返回")} aria-label={t("返回")} onClick={onBack}>
            <ChevronLeft size={15} />
          </button>
          <div className="title">{t("审查")}</div>
        </div>
      </div>
    </div>
  );
}
