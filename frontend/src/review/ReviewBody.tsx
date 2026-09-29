// 审查面板的正文：顶栏（模式开关 + 数据源 + 刷新）+ 改动文件列表。
//
// 顶栏长在正文里而不是顶部 chrome 上，是因为它跟着「审查这一面」走——文件模式下
// 根本不存在这套控件。两态（浮窗/全屏）共用同一个位置，刷新按钮也就只有一处。

import { FileDiff, RefreshCw } from "lucide-react";
import { t, tt } from "../i18n";
import type { PreviewMode } from "../components/preview/useFilePreview";
import { ReviewFileRow } from "./ReviewFileRow";
import { useReviewChanges, type ReviewController } from "./useReviewChanges";

export function ReviewBody({ wsPath, onMode }: {
  wsPath: string | undefined;
  /** 切回文件面（审查面自带的返回钮）。 */
  onMode: (mode: PreviewMode) => void;
}) {
  const review = useReviewChanges(wsPath);
  return (
    <div className="rv-root">
      <div className="rv-bar">
        <button
          type="button"
          className="rv-mode"
          data-tip={tt("回到文件预览", "Back to file preview")}
          aria-label={tt("回到文件预览", "Back to file preview")}
          onClick={() => onMode("file")}
        >
          <FileDiff size={14} />
        </button>
        {/* v1 只有未暂存一档，所以这是静态标签而不是下拉——一个只有一项的下拉是
            死控件。「已暂存」等档位接进来时，这里换成真正的选择器。 */}
        <span className="rv-scope">{t("未暂存")}</span>
        <button
          type="button"
          className="rv-refresh"
          data-busy={review.loading || undefined}
          data-tip={t("刷新")}
          aria-label={t("刷新")}
          onClick={review.refresh}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="rv-list">
        <List review={review} />
      </div>
    </div>
  );
}

function List({ review }: { review: ReviewController }) {
  if (review.loading) return <p className="rv-empty">{t("载入中…")}</p>;
  // 没有 git 是一句陈述不是错误：非仓库 / git 不可用 / 超时都落这里
  if (!review.available) return <p className="rv-empty">{t("此工作区不在 Git 仓库里")}</p>;
  if (review.files.length === 0) return <p className="rv-empty">{t("没有未暂存的改动")}</p>;
  return (
    <>
      {review.files.map((change) => (
        <ReviewFileRow
          key={change.path}
          change={change}
          diff={review.diff(change.path)}
          fetching={review.fetching(change.path)}
          revision={review.revision}
          onRequest={() => review.request(change.path)}
        />
      ))}
    </>
  );
}
