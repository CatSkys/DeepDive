// 引导第 4 步·结尾语：不讲流程，只把"接下来怎么用"说清楚（用户定稿：发消息这步
// 不做实际引导）。文案与 DMG 说明书的三条基本使用同源，别处改了这里也要跟着改。
import { useT } from "../../i18n";
import css from "../OnboardingWizard.module.css";

export function DoneStep() {
  const { t } = useT();
  return (
    <div className={css.step}>
      <div className={css.stepTitle}>{t("开始使用")}</div>
      <div className={css.stepLead}>{t("都准备好了。剩下就一句话的事：")}</div>
      <ul className={css.tips}>
        <li>{t("在下方输入框里打字，回车发送——Agent 在你的项目文件夹里开工。")}</li>
        <li>{t("输入 @ 可以引用项目里的文件，输入 / 可以调命令。")}</li>
        <li>{t("⌥Space 随时唤出窗口；关掉窗口应用仍在菜单栏运行。")}</li>
      </ul>
    </div>
  );
}
