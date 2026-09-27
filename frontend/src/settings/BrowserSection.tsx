import { useState } from "react";
import { ArrowRight, Clock, Download, Shield } from "lucide-react";
import { usePrefs } from "../prefs";
import { useBrowserPrefs, BROWSER_SEARCH_TEMPLATES } from "../sidebar-right/browserPrefs";
import { Dropdown, Toggle } from "../components/controls";
import { t } from "../i18n";
import { BrowserLibrary } from "./BrowserLibrary";
import { BrowserLoginData } from "./BrowserLoginData";
import { BrowserPrivacy } from "./BrowserPrivacy";
import rowsCss from "./SettingsRows.module.css";

const ZOOM_CHOICES = ["0.8", "0.9", "1", "1.1", "1.25", "1.5", "2"].map((value) => ({ value, label: `${Math.round(Number(value) * 100)}%` }));
const SLEEP_CHOICES = [
  { minutes: 5, label: "5 分钟" }, { minutes: 15, label: "15 分钟" },
  { minutes: 30, label: "30 分钟" }, { minutes: 60, label: "1 小时" }, { minutes: 0, label: "永不" },
];

type BrowserView = "home" | "library" | "loginData" | "privacy";

function Entry({ icon: Icon, title, description, onClick }: { icon: typeof Clock; title: string; description: string; onClick: () => void }) {
  return <button className={`${rowsCss.rowCard} ${rowsCss.entryButton}`} onClick={onClick}>
    <Icon size={15} />
    <span className={rowsCss.rowIdentity}><span className={rowsCss.rowName}>{title}</span><span className={rowsCss.rowCaption}>{description}</span></span>
    <ArrowRight size={14} />
  </button>;
}

function Home({ open }: { open: (view: Exclude<BrowserView, "home">) => void }) {
  const prefs = usePrefs();
  const [browser, setBrowser] = useBrowserPrefs();
  const templateId = BROWSER_SEARCH_TEMPLATES.find((item) => item.template === browser.searchTemplate)?.id ?? "custom";
  return <>
    <div className={rowsCss.section}><div className={rowsCss.sectionTitle}>{t("常用")}</div><div className={rowsCss.rowGroup}>
      <div className={rowsCss.rowCard}><span className={rowsCss.rowIdentity}><span className={rowsCss.rowName}>{t("默认缩放")}</span></span><Dropdown options={ZOOM_CHOICES.map((c) => ({ v: c.value, label: c.label }))} value={String(prefs.browserZoomDefault)} onChange={(v) => prefs.setBrowserZoomDefault(Number(v))} /></div>
      <div className={rowsCss.rowCard}><span className={rowsCss.rowIdentity}><span className={rowsCss.rowName}>{t("按站点记住缩放")}</span></span><Toggle on={prefs.browserZoomRememberSite} onChange={prefs.setBrowserZoomRememberSite} /></div>
      <div className={rowsCss.rowCard}><span className={rowsCss.rowIdentity}><span className={rowsCss.rowName}>{t("闲置多久后休眠")}</span></span><Dropdown options={SLEEP_CHOICES.map((c) => ({ v: String(c.minutes), label: t(c.label) }))} value={String(prefs.browserTabSleepMinutes)} onChange={(v) => prefs.setBrowserTabSleepMinutes(Number(v))} /></div>
      <div className={rowsCss.rowCard}><span className={rowsCss.rowIdentity}><span className={rowsCss.rowName}>{t("搜索引擎")}</span></span><Dropdown options={BROWSER_SEARCH_TEMPLATES.map((item) => ({ v: item.id, label: item.label }))} value={templateId} onChange={(id) => { const found = BROWSER_SEARCH_TEMPLATES.find((item) => item.id === id); if (found) setBrowser({ searchTemplate: found.template }); }} /></div>
      <div className={rowsCss.rowCard}><span className={rowsCss.rowIdentity}><span className={rowsCss.rowName}>{t("把普通输入当搜索词")}</span></span><Toggle on={browser.searchOnPlainText} onChange={(v) => setBrowser({ searchOnPlainText: v })} /></div>
    </div></div>
    <div className={rowsCss.section}><div className={rowsCss.sectionTitle}>{t("管理")}</div><div className={rowsCss.rowGroup}>
      <Entry icon={Clock} title={t("历史与书签")} description={t("查看、搜索和清理浏览记录")} onClick={() => open("library")} />
      <Entry icon={Download} title={t("登录数据")} description={t("按需从其他浏览器导入 cookie")} onClick={() => open("loginData")} />
      <Entry icon={Shield} title={t("隐私与权限")} description={t("拦截、站点权限和页面隐藏")} onClick={() => open("privacy")} />
    </div></div>
  </>;
}

export function BrowserSection() {
  const [view, setView] = useState<BrowserView>("home");
  if (view === "library") return <BrowserLibrary onBack={() => setView("home")} />;
  if (view === "loginData") return <BrowserLoginData onBack={() => setView("home")} />;
  if (view === "privacy") return <BrowserPrivacy onBack={() => setView("home")} />;
  return <Home open={setView} />;
}
