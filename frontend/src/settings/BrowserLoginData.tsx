import { ArrowLeft, Download, RefreshCw } from "lucide-react";
import { confirmDialog } from "../components/DialogHost";
import { t, tt } from "../i18n";
import rowsCss from "./SettingsRows.module.css";
import { useBrowserCookies, type CookieResultFace } from "./useBrowserCookies";

function resultText(result: CookieResultFace | null, sourceId: string): string {
  if (!result || result.source !== sourceId) return "";
  if (result.code === "ok") return result.imported < result.total ? tt("已导入 {n} 条（{m} 条解不开，跳过）", "Imported {n} ({m} undecryptable, skipped)", { n: result.imported, m: result.total - result.imported }) : tt("已导入 {n} 条", "Imported {n}", { n: result.imported });
  if (result.code === "no-key") return t("需要在系统弹窗里批准它访问钥匙串，再导一次。");
  if (result.code === "permission") return t("读不到它的 cookie 库：请在系统设置中允许 DeepDive 访问。");
  if (result.code === "missing") return t("找不到它的 cookie 库了。");
  return t("没有可导入的 cookie。");
}

export function BrowserLoginData({ onBack }: { onBack: () => void }) {
  const cookies = useBrowserCookies();
  return <div className={rowsCss.section}>
    <button className={rowsCss.backButton} onClick={onBack}><ArrowLeft size={14} /> {t("浏览器设置")}</button>
    <div className={rowsCss.sectionTitle}>{t("登录数据")}</div>
    <div className={rowsCss.sectionIntro}>{t("只导入 cookie，不会读取或导入密码。")}</div>
    <div className={rowsCss.rowGroup}>
      <div className={rowsCss.rowCard}><div className={rowsCss.rowIdentity}><div className={rowsCss.rowName}>{t("其他浏览器")}</div><div className={rowsCss.rowCaption}>{!cookies.hasScanned ? t("按需扫描本机上可导入的浏览器数据") : cookies.loading ? t("检测中…") : cookies.sources.length === 0 ? t("没检测到可导入的浏览器") : tt("检测到 {n} 个来源", "Found {n} sources", { n: cookies.sources.length })}</div></div><div className={rowsCss.rowActions}><button className={rowsCss.secondaryButton} disabled={cookies.loading || cookies.busy !== ""} onClick={cookies.scan}><RefreshCw size={13} /> {cookies.loading ? t("检测中…") : t("扫描")}</button></div></div>
      {cookies.sources.map((source) => <div className={rowsCss.rowCard} key={source.id}><div className={rowsCss.rowIdentity}><div className={rowsCss.rowName}>{source.name}</div>{(resultText(cookies.result, source.id) || source.blocked) && <div className={rowsCss.rowCaption}>{resultText(cookies.result, source.id) || t("读不到它的数据目录，请在系统设置中放行后重试。")}</div>}</div><div className={rowsCss.rowActions}><button className={rowsCss.primaryButton} disabled={cookies.busy !== "" || source.blocked} onClick={() => { void confirmDialog({ message: tt("从 {name} 导入 cookie？", "Import cookies from {name}?", { name: source.name }) }).then((ok) => { if (ok) cookies.importFrom(source.id); }); }}><Download size={13} /> {cookies.busy === source.id ? t("导入中…") : t("导入")}</button></div></div>)}
      <div className={rowsCss.rowCard}><div className={rowsCss.rowIdentity}><div className={rowsCss.rowName}>{t("清除浏览数据")}</div>{cookies.result?.code === "cleared" && <div className={rowsCss.rowCaption}>{t("已清除：所有站点都退出了登录。")}</div>}</div><div className={rowsCss.rowActions}><button className={rowsCss.secondaryButton} disabled={cookies.busy !== ""} onClick={() => { void confirmDialog({ message: t("清除浏览器 cookie 与站点存储？所有站点都会退出登录。"), danger: true }).then((ok) => { if (ok) cookies.clear(); }); }}>{cookies.busy === "clear" ? t("清除中…") : t("清除")}</button></div></div>
    </div>
  </div>;
}
