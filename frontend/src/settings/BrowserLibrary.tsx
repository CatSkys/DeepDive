// 「设置 → 浏览器 → 历史与书签」两张表：壳是事实源（`BrowserHistory` / `BrowserBookmarks`），
// 这里只渲染与发命令。历史可过滤（在前端过滤：推过来的是最近 200 条，够用）。
import { useEffect, useState } from "react";
import { Clock, Star, Trash2, X } from "lucide-react";
import { t, tt } from "../i18n";
import { confirmDialog } from "../components/DialogHost";
import { useBrowserHistory, type HistoryVisit } from "../sidebar-right/browserHistory";
import { sendToShell } from "../host";
import rowsCss from "./SettingsRows.module.css";

/** 时间：今天只给时分，其余给月日（历史表里"哪一天"比"哪一秒"重要）。 */
function when(at: number): string {
  const date = new Date(at);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
}

/** 在浏览器里打开（面板切到浏览器页由用户自己决定；这里只把地址交给当前标签）。 */
function open(url: string): void {
  sendToShell({ type: "browser-nav", action: "load", url });
}

export function BrowserLibrary() {
  const library = useBrowserHistory();
  const [filter, setFilter] = useState("");

  const refresh = library.refresh;
  useEffect(() => { refresh(); }, [refresh]);

  const needle = filter.trim().toLowerCase();
  const visits = needle === ""
    ? library.visits
    : library.visits.filter((v) => v.url.toLowerCase().includes(needle) || v.title.toLowerCase().includes(needle));

  return (
    <>
      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("历史与书签")}</div>
        <div className={rowsCss.sectionIntro}>
          {tt("浏览器去过哪儿、收藏了什么，都记在这台机器上（最近 {n} 条）。", "Where the browser has been and what it saved, kept on this Mac (latest {n}).", { n: library.total })}
        </div>
        <div className={rowsCss.blockCard}>
          <div className={rowsCss.blockHead}>
            <div className={rowsCss.blockTitle}>
              <Clock size={13} /> {t("历史")}
            </div>
            <div className={rowsCss.blockScanRow}>
              <input
                className={rowsCss.listFilter}
                value={filter}
                placeholder={t("过滤地址或标题")}
                onChange={(e) => setFilter(e.target.value)}
              />
              <button
                className={rowsCss.secondaryButton}
                disabled={library.total === 0}
                onClick={() => {
                  void confirmDialog({ message: t("清空全部浏览历史？"), danger: true })
                    .then((ok) => { if (ok) library.clear(); });
                }}
              >
                <Trash2 size={13} /> {t("清空")}
              </button>
            </div>
          </div>
          {visits.length === 0 && <div className={rowsCss.blockDesc}>{filter === "" ? t("还没有记录。") : t("没有匹配的记录。")}</div>}
          {visits.length > 0 && (
            <div className={rowsCss.listScroll}>
              {visits.map((visit: HistoryVisit) => (
                <div className={rowsCss.blockRow} key={visit.url}>
                  <div className={rowsCss.rowIdentity}>
                    <button className={rowsCss.listMain} onClick={() => open(visit.url)}>
                      <span className={rowsCss.listTitle}>{visit.title}</span>
                      <span className={rowsCss.listUrl}>{visit.url}</span>
                    </button>
                  </div>
                  <div className={rowsCss.rowActions}>
                    <span className={rowsCss.rowCaption}>{when(visit.at)}</span>
                    <button className={rowsCss.iconBtn} aria-label={t("从历史里删掉")} data-tip={t("从历史里删掉")} onClick={() => library.remove(visit.url)}>
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={rowsCss.blockCard}>
          <div className={rowsCss.blockHead}>
            <div className={rowsCss.blockTitle}>
              <Star size={13} /> {t("书签")}
            </div>
            <div className={rowsCss.blockScanRow}>
              <button className={rowsCss.secondaryButton} disabled={library.bookmarks.length === 0} onClick={library.clearBookmarks}>
                <Trash2 size={13} /> {t("清空")}
              </button>
            </div>
          </div>
          {library.bookmarks.length === 0 && <div className={rowsCss.blockDesc}>{t("还没有书签。在面板「…」菜单里收藏当前页。")}</div>}
          {library.bookmarks.map((mark) => (
            <div className={rowsCss.blockRow} key={mark.url}>
              <div className={rowsCss.rowIdentity}>
                <button className={rowsCss.listMain} onClick={() => open(mark.url)}>
                  <span className={rowsCss.listTitle}>{mark.title}</span>
                  <span className={rowsCss.listUrl}>{mark.url}</span>
                </button>
              </div>
              <div className={rowsCss.rowActions}>
                <button className={rowsCss.iconBtn} aria-label={t("删掉书签")} data-tip={t("删掉书签")} onClick={() => library.removeBookmark(mark.url)}>
                  <X size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
