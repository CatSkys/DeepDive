// 「浏览器」设置页：这一格变成"人和 agent 都用"的浏览器之后，它的开关/值都收在这儿，
// 不散落在面板里（用户定稿：设置项统一进设置页）。
//
// 三类落点：
//   · **壳侧**（缩放默认值、按站点记忆）读 UserDefaults，走 `prefs` 下发 / `browser-zoom` 写回——
//     因为壳在 `didCommit` 时要用它们；
//   · **客户端**（搜索引擎模板、纯文本当搜索）是纯交互偏好，落 localStorage（browserPrefs）；
//   · 以后的块（拦截、权限、导入、历史）各自加到本页，**不预先留空分区**。
import { useEffect } from "react";
import { Download, RefreshCw } from "lucide-react";
import { usePrefs } from "../prefs";
import { useBrowserPrefs, BROWSER_SEARCH_TEMPLATES } from "../sidebar-right/browserPrefs";
import { Dropdown, Toggle } from "../components/controls";
import { confirmDialog } from "../components/DialogHost";
import { t, tt } from "../i18n";
import { useBrowserCookies, type CookieResultFace } from "./useBrowserCookies";
import { useBrowserShield } from "./useBrowserShield";
import { BrowserLibrary } from "./BrowserLibrary";
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

/** 一次导入/清除的结果 → 那一行下面的一句话。码由壳给（见 BrowserCookieImport.Code）。 */
function resultText(result: CookieResultFace | null | undefined, sourceId: string): string {
  if (result == null || result.source !== sourceId) return "";
  if (result.code === "ok") {
    return result.imported < result.total
      ? tt("已导入 {n} 条（{m} 条解不开，跳过）", "Imported {n} ({m} undecryptable, skipped)", { n: result.imported, m: result.total - result.imported })
      : tt("已导入 {n} 条", "Imported {n}", { n: result.imported });
  }
  if (result.code === "no-key") return t("需要在系统弹窗里批准它访问钥匙串，再导一次。");
  if (result.code === "permission") return t("读不到它的 cookie 库：要在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」里允许 DeepDive。");
  if (result.code === "missing") return t("找不到它的 cookie 库了（浏览器可能已经卸载）。");
  return t("没有可导入的 cookie。");
}

/** 休眠门槛候选（分钟；0 = 永不）。壳侧默认 30 分钟（BrowserTabs.defaultSleepMinutes）。 */
const SLEEP_CHOICES = [
  { minutes: 5, label: "5 分钟" },
  { minutes: 15, label: "15 分钟" },
  { minutes: 30, label: "30 分钟" },
  { minutes: 60, label: "1 小时" },
  { minutes: 0, label: "永不" },
];

export function BrowserSection() {
  const prefs = usePrefs();
  const [browser, setBrowser] = useBrowserPrefs();
  const cookies = useBrowserCookies();
  const shield = useBrowserShield();
  const templateId = BROWSER_SEARCH_TEMPLATES.find((item) => item.template === browser.searchTemplate)?.id ?? "custom";

  // 进这一页才问一次来源（壳只在被问的时候去扫磁盘上那几个目录）
  const refreshCookies = cookies.refresh;
  useEffect(() => { refreshCookies(); }, [refreshCookies]);
  const syncShield = shield.sync;
  useEffect(() => { syncShield(); }, [syncShield]);

  return (
    <>
      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("缩放")}</div>
        <div className={rowsCss.rowGroup}>
          <div className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("默认缩放")}</div>
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
            </div>
            <div className={rowsCss.rowActions}>
              <Toggle on={prefs.browserZoomRememberSite} onChange={prefs.setBrowserZoomRememberSite} />
            </div>
          </div>
        </div>
      </div>

      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("标签页")}</div>
        <div className={rowsCss.rowGroup}>
          <div className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("闲置多久后休眠")}</div>
            </div>
            <div className={rowsCss.rowActions}>
              <Dropdown
                options={SLEEP_CHOICES.map((c) => ({ v: String(c.minutes), label: t(c.label) }))}
                value={String(prefs.browserTabSleepMinutes)}
                onChange={(v) => prefs.setBrowserTabSleepMinutes(Number(v))}
              />
            </div>
          </div>
        </div>
      </div>

      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("登录态")}</div>
        <div className={rowsCss.rowGroup}>
          {cookies.sources.length === 0 && (
            <div className={rowsCss.rowCard}>
              <div className={rowsCss.rowIdentity}>
                <div className={rowsCss.rowName}>{t("没检测到可导入的浏览器")}</div>
              </div>
              <div className={rowsCss.rowActions}>
                <button className={rowsCss.secondaryButton} onClick={cookies.refresh}>
                  <RefreshCw size={13} />
                  {t("重新检测")}
                </button>
              </div>
            </div>
          )}
          {cookies.sources.map((source) => (
            <div className={rowsCss.rowCard} key={source.id}>
              <div className={rowsCss.rowIdentity}>
                <div className={rowsCss.rowName}>{source.name}</div>
                {(resultText(cookies.result, source.id) || source.blocked) && (
                  <div className={rowsCss.rowCaption}>
                    {resultText(cookies.result, source.id)
                      || t("读不到它的数据目录：系统挡着「别的应用的数据」，到这个浏览器的数据上放行一次再导。")}
                  </div>
                )}
              </div>
              <div className={rowsCss.rowActions}>
                <button className={rowsCss.primaryButton} disabled={cookies.busy !== ""} onClick={() => cookies.importFrom(source.id)}>
                  <Download size={13} />
                  {cookies.busy === source.id ? t("导入中…") : t("导入")}
                </button>
              </div>
            </div>
          ))}
          <div className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("清除浏览数据")}</div>
              {cookies.result?.code === "cleared" && (
                <div className={rowsCss.rowCaption}>{t("已清除：所有站点都退出了登录。")}</div>
              )}
            </div>
            <div className={rowsCss.rowActions}>
              <button
                className={rowsCss.secondaryButton}
                disabled={cookies.busy !== ""}
                onClick={() => {
                  void confirmDialog({ message: t("清除浏览器 cookie 与站点存储？所有站点都会退出登录。"), danger: true })
                    .then((ok) => { if (ok) cookies.clear(); });
                }}
              >
                {cookies.busy === "clear" ? t("清除中…") : t("清除")}
              </button>
            </div>
          </div>
        </div>
      </div>

      <BrowserLibrary />

      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("隐私")}</div>
        {shield.state.trouble !== "" && (
          <div className={rowsCss.sectionIntro}>{tt("拦截规则没编译成功（现在什么都没挡）：{m}", "The block list did not compile (nothing is being blocked): {m}", { m: shield.state.trouble })}</div>
        )}
        <div className={rowsCss.rowGroup}>
          <div className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("拦截跟踪与广告")}</div>
              {shield.state.paused.length > 0 && (
                <div className={rowsCss.rowCaption}>
                  {tt("已对 {n} 个站点暂停", "Paused for {n} sites", { n: shield.state.paused.length })}
                </div>
              )}
            </div>
            <div className={rowsCss.rowActions}>
              <Toggle on={shield.state.enabled} onChange={shield.setEnabled} />
            </div>
          </div>
          <div className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("按站暂停的拦截")}</div>
              {shield.state.paused.length > 0 && (
                <div className={rowsCss.rowCaption}>{shield.state.paused.join("、")}</div>
              )}
            </div>
            <div className={rowsCss.rowActions}>
              <button className={rowsCss.secondaryButton} disabled={shield.state.paused.length === 0} onClick={shield.forgetPaused}>
                {t("全部恢复")}
              </button>
            </div>
          </div>
          <div className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("页面隐藏")}</div>
            </div>
            <div className={rowsCss.rowActions}>
              <button className={rowsCss.secondaryButton} disabled={shield.state.hidden === 0} onClick={shield.forgetHidden}>
                {tt("全部恢复（{n}）", "Restore all ({n})", { n: shield.state.hidden })}
              </button>
            </div>
          </div>
          <div className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("记住的摄像头/麦克风权限")}</div>
            </div>
            <div className={rowsCss.rowActions}>
              <button className={rowsCss.secondaryButton} disabled={shield.state.permissions === 0} onClick={shield.forgetPermissions}>
                {tt("忘记全部（{n}）", "Forget all ({n})", { n: shield.state.permissions })}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("地址栏")}</div>
        <div className={rowsCss.rowGroup}>
          <div className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("搜索引擎")}</div>
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
            </div>
            <div className={rowsCss.rowActions}>
              <Toggle on={browser.searchOnPlainText} onChange={(v) => setBrowser({ searchOnPlainText: v })} />
            </div>
          </div>
        </div>
      </div>

      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("快捷键")}</div>
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
