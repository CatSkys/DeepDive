import { useEffect, useState } from "react";
import { ArrowLeft, Clock, Star, Trash2, X } from "lucide-react";
import { t } from "../i18n";
import { confirmDialog } from "../components/DialogHost";
import { useBrowserHistory, type HistoryVisit } from "../sidebar-right/browserHistory";
import { sendToShell } from "../host";
import rowsCss from "./SettingsRows.module.css";

function when(at: number): string {
  const date = new Date(at);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
}

function open(url: string): void {
  sendToShell({ type: "browser-nav", action: "load", url });
}

export function BrowserLibrary({ onBack }: { onBack: () => void }) {
  const library = useBrowserHistory();
  const [tab, setTab] = useState<"history" | "bookmarks">("history");
  const [filter, setFilter] = useState("");

  const refreshHistory = library.refreshHistory;
  const refreshBookmarks = library.refreshBookmarks;
  useEffect(() => {
    if (tab === "history") refreshHistory();
    else refreshBookmarks();
  }, [tab, refreshHistory, refreshBookmarks]);

  const needle = filter.trim().toLowerCase();
  const visits = needle === ""
    ? library.visits
    : library.visits.filter((visit) => visit.url.toLowerCase().includes(needle) || visit.title.toLowerCase().includes(needle));

  return (
    <div className={rowsCss.section}>
      <button className={rowsCss.backButton} onClick={onBack}><ArrowLeft size={14} /> {t("浏览器设置")}</button>
      <div className={rowsCss.sectionTitle}>{t("历史与书签")}</div>
      <div className={rowsCss.tabBar} role="tablist">
        <button className={tab === "history" ? rowsCss.tabActive : rowsCss.tab} onClick={() => setTab("history")} role="tab" aria-selected={tab === "history"}><Clock size={13} /> {t("历史")}</button>
        <button className={tab === "bookmarks" ? rowsCss.tabActive : rowsCss.tab} onClick={() => setTab("bookmarks")} role="tab" aria-selected={tab === "bookmarks"}><Star size={13} /> {t("书签")}</button>
      </div>
      {tab === "history" ? (
        <div className={rowsCss.blockCard}>
          <div className={rowsCss.listHead}><input className={rowsCss.listFilter} value={filter} placeholder={t("过滤地址或标题")} onChange={(event) => setFilter(event.target.value)} /><button className={rowsCss.secondaryButton} disabled={library.total === 0} onClick={() => { void confirmDialog({ message: t("清空全部浏览历史？"), danger: true }).then((ok) => { if (ok) library.clear(); }); }}><Trash2 size={13} /> {t("清空")}</button></div>
          {visits.length === 0 ? <div className={rowsCss.blockDesc}>{filter === "" ? t("还没有记录。") : t("没有匹配的记录。")}</div> : <div className={rowsCss.listScroll}>{visits.map((visit: HistoryVisit) => <div className={rowsCss.blockRow} key={visit.url}><div className={rowsCss.rowIdentity}><button className={rowsCss.listMain} onClick={() => open(visit.url)}><span className={rowsCss.listTitle}>{visit.title}</span><span className={rowsCss.listUrl}>{visit.url}</span></button></div><div className={rowsCss.rowActions}><span className={rowsCss.rowCaption}>{when(visit.at)}</span><button className={rowsCss.iconBtn} aria-label={t("从历史里删掉")} onClick={() => library.remove(visit.url)}><X size={12} /></button></div></div>)}</div>}
        </div>
      ) : (
        <div className={rowsCss.blockCard}>
          <div className={rowsCss.listHead}><div className={rowsCss.blockTitle}><Star size={13} /> {t("书签")}</div><button className={rowsCss.secondaryButton} disabled={library.bookmarks.length === 0} onClick={() => { void confirmDialog({ message: t("清空全部书签？"), danger: true }).then((ok) => { if (ok) library.clearBookmarks(); }); }}><Trash2 size={13} /> {t("清空")}</button></div>
          {library.bookmarks.length === 0 ? <div className={rowsCss.blockDesc}>{t("还没有书签。")}</div> : <div className={rowsCss.listScroll}>{library.bookmarks.map((mark) => <div className={rowsCss.blockRow} key={mark.url}><div className={rowsCss.rowIdentity}><button className={rowsCss.listMain} onClick={() => open(mark.url)}><span className={rowsCss.listTitle}>{mark.title}</span><span className={rowsCss.listUrl}>{mark.url}</span></button></div><div className={rowsCss.rowActions}><button className={rowsCss.iconBtn} aria-label={t("删掉书签")} onClick={() => library.removeBookmark(mark.url)}><X size={12} /></button></div></div>)}</div>}
        </div>
      )}
    </div>
  );
}
