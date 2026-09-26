// 「浏览器」设置页：这一格变成"人和 agent 都用"的浏览器之后，它的开关/值都收在这儿，
// 不散落在面板里（用户定稿：设置项统一进设置页）。
//
// 三类落点：
//   · **壳侧**（缩放默认值、按站点记忆）读 UserDefaults，走 `prefs` 下发 / `browser-zoom` 写回——
//     因为壳在 `didCommit` 时要用它们；
//   · **客户端**（搜索引擎模板、纯文本当搜索）是纯交互偏好，落 localStorage（browserPrefs）；
//   · 以后的块（拦截、权限、导入、历史）各自加到本页，**不预先留空分区**。
import { usePrefs } from "../prefs";
import { useBrowserPrefs, BROWSER_SEARCH_TEMPLATES } from "../sidebar-right/browserPrefs";
import { Dropdown, Toggle } from "../components/controls";
import { t } from "../i18n";
import rowsCss from "./SettingsRows.module.css";

/** 默认缩放候选（与壳侧 BrowserZoom.steps 同一量级，取人常用的几个）。 */
const ZOOM_CHOICES = [
  { value: "0.8", label: "80%" },
  { value: "0.9", label: "90%" },
  { value: "1", label: "100%" },
  { value: "1.1", label: "110%" },
  { value: "1.25", label: "125%" },
  { value: "1.5", label: "150%" },
  { value: "2", label: "200%" },
];

export function BrowserSection() {
  const prefs = usePrefs();
  const [browser, setBrowser] = useBrowserPrefs();
  const templateId = BROWSER_SEARCH_TEMPLATES.find((item) => item.template === browser.searchTemplate)?.id ?? "custom";

  return (
    <>
      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("缩放")}</div>
        <div className={rowsCss.sectionIntro}>
          {t("缩放是让页面按新尺寸重新排版（不是放大镜），所以它同时影响排版与清晰度。")}
        </div>
        <div className={rowsCss.rowGroup}>
          <div className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("默认缩放")}</div>
              <div className={rowsCss.rowCaption}>{t("新打开的站点没记住过缩放时用这个值。")}</div>
            </div>
            <div className={rowsCss.rowActions}>
              <Dropdown
                options={ZOOM_CHOICES.map((c) => ({ v: c.value, label: c.label }))}
                value={String(prefs.browserZoomDefault)}
                onChange={(v) => prefs.setBrowserZoomDefault(Number(v))}
              />
            </div>
          </div>
          <div className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("按站点记住缩放")}</div>
              <div className={rowsCss.rowCaption}>{t("关掉后所有站点都用默认缩放。")}</div>
            </div>
            <div className={rowsCss.rowActions}>
              <Toggle on={prefs.browserZoomRememberSite} onChange={prefs.setBrowserZoomRememberSite} />
            </div>
          </div>
        </div>
      </div>

      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("地址栏")}</div>
        <div className={rowsCss.sectionIntro}>{t("输入的既可能是地址也可能是要找的东西。")}</div>
        <div className={rowsCss.rowGroup}>
          <div className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("搜索引擎")}</div>
              <div className={rowsCss.rowCaption}>{t("判不出是地址的输入走这里。")}</div>
            </div>
            <div className={rowsCss.rowActions}>
              <Dropdown
                options={BROWSER_SEARCH_TEMPLATES.map((item) => ({ v: item.id, label: item.label }))}
                value={templateId}
                onChange={(id) => {
                  const found = BROWSER_SEARCH_TEMPLATES.find((item) => item.id === id);
                  if (found) setBrowser({ searchTemplate: found.template });
                }}
              />
            </div>
          </div>
          <div className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("把普通输入当搜索词")}</div>
              <div className={rowsCss.rowCaption}>{t("关掉后只有写了协议或域名的才当地址。")}</div>
            </div>
            <div className={rowsCss.rowActions}>
              <Toggle on={browser.searchOnPlainText} onChange={(v) => setBrowser({ searchOnPlainText: v })} />
            </div>
          </div>
        </div>
      </div>

      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("快捷键")}</div>
        <div className={rowsCss.sectionIntro}>
          {t("焦点在网页里时由壳接管这些组合（否则页面会先吃掉它们）。")}
        </div>
        <div className={rowsCss.rowGroup}>
          <div className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>⌘L {t("聚焦地址栏")} · ⌘F {t("页内查找")} · ⌘G / ⇧⌘G {t("下一个 / 上一个")}</div>
              <div className={rowsCss.rowCaption}>⌘[ ⌘] {t("后退 / 前进")} · ⌘R {t("刷新")} · ⌘+ ⌘- ⌘0 {t("放大 / 缩小 / 重置")}</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
