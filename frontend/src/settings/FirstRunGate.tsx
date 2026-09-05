// 首启引导门：引擎在跑且 credentials.describe 正向确证「没有任何已配置密钥」
// 时接管整窗，复用 ModelDialog（guided 模式）配出第一个模型；保存成功即
// 放行进入主界面。读失败 ≠ 未配置（configuredKnown 语义）——引擎瞬断时
// 门绝不出现，密钥已配好的老用户不可能被锁进引导页。
import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { ModelDialog } from "./ModelDialog";
import { useModelCatalog } from "./useModelCatalog";
import cssRows from "./SettingsRows.module.css";
// 品牌鲸鱼：design/logo 定稿导出物（黑底反白）的副本，卡片本就是深底
import logoUrl from "../assets/deepdive-logo-256.png";

export function FirstRunGate({ children }: { children: ReactNode }) {
  const store = useStore();
  const { t } = useT();
  const cat = useModelCatalog();
  const { reload } = cat;
  // 保存后 reload 仍未配出密钥 → 换一份新表单（key=attempt）并给提示行
  const [attempt, setAttempt] = useState(0);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (store.engineUp) void reload();
  }, [store.engineUp, reload]);

  if (!(cat.configuredKnown && !cat.anyConfigured)) return <>{children}</>;

  return (
    <div className="app">
      <ModelDialog
        key={attempt}
        guided
        header={
          <div className={cssRows.onboardingWelcome}>
            <img className={cssRows.onboardingLogo} src={logoUrl} alt="" width={56} height={56} />
            <div className={cssRows.onboardingTitle}>{t("欢迎使用 DeepDive")}</div>
            <div className={cssRows.onboardingDesc}>
              {t("先添加一个模型——选择提供方并填入 API Key，保存后立即生效，即可开始对话。")}
            </div>
            {hint && (
              <div className={cssRows.onboardingHint}>
                {t("尚未检测到已保存的 API Key——请填写密钥后保存。")}
              </div>
            )}
          </div>
        }
        providers={cat.providers}
        deepseek={cat.deepseek}
        pi={cat.pi}
        edit={null}
        credentials={cat.credentials}
        onDone={() => {
          void cat.reload().then((any) => {
            if (!any) {
              setHint(true);
              setAttempt((a) => a + 1);
            }
          });
        }}
        onCancel={() => undefined} // guided 模式没有可触发的关闭路径
      />
    </div>
  );
}
