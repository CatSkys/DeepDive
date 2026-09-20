// 新手引导卡（替代旧的首启门 FirstRunGate）：迁移 → 模型 → 项目 → 结尾语，四步全部
// 在卡内完成。管什么：卡片骨架（左栏品牌 + 步进列表 + 底栏导航）；不管什么：各步的
// 表单与落库（在 steps/ 下，能力全部复用现有 API 与宿主消息）。
//
// 版式（用户定稿）：卡 880×560，左栏固定 216px 步进（窄），右栏吃满剩下一半以上；
// **导航统一在右下角**（上一步 / 下一步，末步是「开始使用」）；不再有"跳过"按钮——
// 右上角的 × 就是整卡退出，单步不做副操作。卡是盖在主界面上的覆盖层（不替换：
// 用户能看到自己的侧栏在下面长出来）。
import { Check, X } from "lucide-react";
import { useT } from "../i18n";
import { ONBOARDING_STEPS, useOnboarding, type OnboardingStepId } from "./useOnboarding";
import { MigrateStep } from "./steps/MigrateStep";
import { ModelStep } from "./steps/ModelStep";
import { ProjectStep } from "./steps/ProjectStep";
import { DoneStep } from "./steps/DoneStep";
import css from "./OnboardingWizard.module.css";
import logoUrl from "../assets/deepdive-logo-256.png";

/** 步骤文案（中英成对，进 i18n 词典）。 */
const STEP_LABELS: Record<OnboardingStepId, [string, string]> = {
  migrate: ["迁移已有数据", "Migrate your data"],
  model: ["配置模型", "Set up a model"],
  project: ["新建项目", "Create a project"],
  done: ["开始使用", "Get started"],
};

export function OnboardingWizard({ children }: { children: React.ReactNode }) {
  const { t, tt } = useT();
  const ob = useOnboarding();

  if (!ob.visible) return <>{children}</>;
  const { stepIndex, completed, setStep, next, back, skip, finish } = ob;
  const last = stepIndex === ONBOARDING_STEPS.length - 1;

  return (
    <>
      {children}
      <div className={css.overlay}>
        <div className={css.card} role="dialog" aria-modal="true" aria-label={t("新手引导")}>
          <button className={css.close} onClick={skip} aria-label={t("关闭引导")} title={t("关闭引导")}>
            <X size={15} />
          </button>
          <div className={css.left}>
            <span className={css.badge}>{t("新手引导")}</span>
            <img className={css.logo} src={logoUrl} alt="" width={44} height={44} />
            <div className={css.title}>{t("欢迎使用 DeepDive")}</div>
            <ol className={css.steps}>
              {ONBOARDING_STEPS.map((id, index) => {
                const isCurrent = index === stepIndex;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className={isCurrent ? `${css.stepRow} ${css.stepCurrent}` : css.stepRow}
                      onClick={() => setStep(index)}
                      aria-current={isCurrent ? "step" : undefined}
                    >
                      <span className={completed[id] ? `${css.stepMark} ${css.stepDone}` : css.stepMark}>
                        {completed[id] ? <Check size={12} /> : index + 1}
                      </span>
                      <span className={css.stepLabel}>{tt(STEP_LABELS[id][0], STEP_LABELS[id][1])}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <div className={css.spacer} />
            <div className={css.caption}>{t("每一步都可以跳过，之后在设置里随时能改。")}</div>
          </div>
          <div className={css.right}>
            <div className={css.metal} aria-hidden="true" />
            <div className={css.stepBody}>
              {ob.step === "migrate" && <MigrateStep />}
              {ob.step === "model" && <ModelStep />}
              {ob.step === "project" && <ProjectStep />}
              {ob.step === "done" && <DoneStep />}
            </div>
            {/* 导航统一在右下角：上一步 | 下一步（末步＝开始使用） */}
            <div className={css.foot}>
              {stepIndex > 0 && (
                <button type="button" className={css.secondary} onClick={back}>{t("上一步")}</button>
              )}
              <button type="button" className={css.primary} onClick={last ? finish : next}>
                {last ? t("开始使用") : t("下一步")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
