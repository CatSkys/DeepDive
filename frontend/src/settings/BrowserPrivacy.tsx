import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { confirmDialog } from "../components/DialogHost";
import { t, tt } from "../i18n";
import { Toggle } from "../components/controls";
import rowsCss from "./SettingsRows.module.css";
import { useBrowserShield } from "./useBrowserShield";

export function BrowserPrivacy({ onBack }: { onBack: () => void }) {
  const shield = useBrowserShield();
  const sync = shield.sync;
  useEffect(() => { sync(); }, [sync]);
  const confirm = (message: string, action: () => void) => { void confirmDialog({ message, danger: true }).then((ok) => { if (ok) action(); }); };
  return <div className={rowsCss.section}>
    <button className={rowsCss.backButton} onClick={onBack}><ArrowLeft size={14} /> {t("浏览器设置")}</button>
    <div className={rowsCss.sectionTitle}>{t("隐私与权限")}</div>
    {shield.state.trouble !== "" && <div className={rowsCss.sectionIntro}>{tt("拦截规则没编译成功（现在什么都没挡）：{m}", "The block list did not compile (nothing is being blocked): {m}", { m: shield.state.trouble })}</div>}
    <div className={rowsCss.rowGroup}>
      <div className={rowsCss.rowCard}><div className={rowsCss.rowIdentity}><div className={rowsCss.rowName}>{t("拦截跟踪与广告")}</div>{shield.state.paused.length > 0 && <div className={rowsCss.rowCaption}>{tt("已对 {n} 个站点暂停", "Paused for {n} sites", { n: shield.state.paused.length })}</div>}</div><div className={rowsCss.rowActions}><Toggle on={shield.state.enabled} onChange={shield.setEnabled} /></div></div>
      <div className={rowsCss.rowCard}><div className={rowsCss.rowIdentity}><div className={rowsCss.rowName}>{t("按站暂停的拦截")}</div>{shield.state.paused.length > 0 && <div className={rowsCss.rowCaption}>{shield.state.paused.join("、")}</div>}</div><div className={rowsCss.rowActions}><button className={rowsCss.secondaryButton} disabled={shield.state.paused.length === 0} onClick={() => confirm(t("恢复所有站点的拦截？"), shield.forgetPaused)}>{t("全部恢复")}</button></div></div>
      <div className={rowsCss.rowCard}><div className={rowsCss.rowIdentity}><div className={rowsCss.rowName}>{t("页面隐藏")}</div></div><div className={rowsCss.rowActions}><button className={rowsCss.secondaryButton} disabled={shield.state.hidden === 0} onClick={() => confirm(t("恢复所有隐藏的页面元素？"), shield.forgetHidden)}>{tt("全部恢复（{n}）", "Restore all ({n})", { n: shield.state.hidden })}</button></div></div>
      <div className={rowsCss.rowCard}><div className={rowsCss.rowIdentity}><div className={rowsCss.rowName}>{t("记住的摄像头/麦克风权限")}</div></div><div className={rowsCss.rowActions}><button className={rowsCss.secondaryButton} disabled={shield.state.permissions === 0} onClick={() => confirm(t("忘记所有摄像头和麦克风权限？"), shield.forgetPermissions)}>{tt("忘记全部（{n}）", "Forget all ({n})", { n: shield.state.permissions })}</button></div></div>
    </div>
  </div>;
}
