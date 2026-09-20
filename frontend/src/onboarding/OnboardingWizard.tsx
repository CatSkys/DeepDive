// 新手引导卡（替代旧的首启门 FirstRunGate）：迁移 → 模型 → 项目 → 结尾语，四步全部
// 在卡内完成。管什么：卡片骨架（左栏品牌 + 步进列表 + 底栏导航）；不管什么：各步的
// 表单与落库（在 steps/ 下，能力全部复用现有 API 与宿主消息）。
//
// 版式（用户定稿）：卡 880×560，左栏固定 216px 步进（窄），右栏吃满剩下一半以上；
// **导航统一在右下角**（上一步 / 下一步，末步是「开始使用」）；不再有"跳过"按钮——
// 右上角的 × 就是整卡退出，单步不做副操作。卡是盖在主界面上的覆盖层（不替换：
// 用户能看到自己的侧栏在下面长出来）。
import { useCallback, useRef, useState } from "react";
import { Check, Info, X } from "lucide-react";
import { useT } from "../i18n";
import { ONBOARDING_STEPS, useOnboarding, type OnboardingStepId } from "./useOnboarding";
import { MigrateStep } from "./steps/MigrateStep";
import { ModelStep } from "./steps/ModelStep";
import { ProjectStep } from "./steps/ProjectStep";
import { DoneStep } from "./steps/DoneStep";
import { OnboardingCatalogProvider } from "./catalog";
import { Confetti } from "./Confetti";
import { playCelebrationChime } from "./celebrate";
import { useModelCatalog } from "../settings/useModelCatalog";
import css from "./OnboardingWizard.module.css";
import logoUrl from "../assets/deepdive-logo-256.png";

/** 步骤文案（中英成对，进 i18n 词典）。 */
const STEP_LABELS: Record<OnboardingStepId, [string, string]> = {
  migrate: ["迁移已有数据", "Migrate your data"],
  model: ["配置模型", "Set up a model"],
  project: ["新建项目", "Create a project"],
  done: ["开始使用", "Get started"],
};

export function OnboardingWizard({ children, forced = false, onClosed }: {
  children: React.ReactNode;
  /** 菜单「帮助 → 新手引导」强制打开。 */
  forced?: boolean;
  /** 关闭（× / 开始使用）：调用方清掉强制标记。 */
  onClosed?: () => void;
}) {
  const { t, tt } = useT();
  const ob = useOnboarding({ forced });
  // 卡片内唯一一份模型目录：各步共用（配置步改了密钥，左栏打勾与迁移计划同帧更新）。
  const catalog = useModelCatalog();
  // 步骤切换的方向（前进/后退各一套入场动画）与"下一步前先做的事"（项目步：下一步=创建）。
  const prevIndex = useRef(ob.stepIndex);
  const direction = ob.stepIndex >= prevIndex.current ? "fwd" : "back";
  prevIndex.current = ob.stepIndex;
  // 当前步登记的主操作（迁移步＝导入并前进；项目步＝创建并前进）。未登记时用默认
  // 的「下一步 / 开始使用」——底栏永远只有一个前进按钮，不做重复动作。
  const [primary, setPrimary] = useState<{ label: string; run: () => void | Promise<void>; disabled?: boolean } | null>(null);
  /** 收尾庆祝：礼花撒完（或降低动效时立即）再关卡片。 */
  const [celebrating, setCelebrating] = useState(false);
  const registerPrimary = useCallback((next: { label: string; run: () => void | Promise<void>; disabled?: boolean } | null) => {
    setPrimary(next);
  }, []);

  if (!ob.visible) return <>{children}</>;
  const { stepIndex, completed, setStep, next, back, skip, finish } = ob;
  const last = stepIndex === ONBOARDING_STEPS.length - 1;
  const goForward = async () => {
    if (primary) { await primary.run(); return; }
    if (last) { playCelebrationChime(); setCelebrating(true); return; } // 礼花跑完再关（见 Confetti onDone）
    next();
  };

  return (
    <>
      {children}
      {celebrating && (
        <Confetti
          onDone={() => { setCelebrating(false); finish(); onClosed?.(); }}
        />
      )}
      <div className={css.overlay}>
        <div className={css.card} role="dialog" aria-modal="true" aria-label={t("新手引导")}>
          <button className={css.close} onClick={() => { skip(); onClosed?.(); }} aria-label={t("关闭引导")} title={t("关闭引导")}>
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
            {/* 左下角的小 ⓘ：说明收在这里，悬停才出（用户定稿） */}
            <button
              type="button"
              className={css.infoCorner}
              data-tip={t("随时可在设置里更改")}
              aria-label={t("随时可在设置里更改")}
            >
              <Info size={13} />
            </button>
          </div>
          <div className={css.right}>
            <div className={css.metal} aria-hidden="true" />
            {/* key 让每次切步都重新挂载 → 入场动画真的重放（方向决定从哪边进） */}
            <div key={ob.step} className={direction === "fwd" ? `${css.stepBody} ${css.stepInFwd}` : `${css.stepBody} ${css.stepInBack}`}>
              <OnboardingCatalogProvider value={catalog}>
                {ob.step === "migrate" && <MigrateStep onNext={next} registerPrimary={registerPrimary} />}
                {ob.step === "model" && <ModelStep />}
                {ob.step === "project" && <ProjectStep onNext={next} registerPrimary={registerPrimary} />}
                {ob.step === "done" && <DoneStep />}
              </OnboardingCatalogProvider>
            </div>
            {/* 导航统一在右下角：上一步 | 下一步（末步＝开始使用） */}
            <div className={css.foot}>
              {stepIndex > 0 && (
                <button type="button" className={css.secondary} onClick={back}>{t("上一步")}</button>
              )}
              <button type="button" className={css.primary} disabled={primary?.disabled} onClick={() => void goForward()}>
                {primary?.label ?? (last ? t("开始使用") : t("下一步"))}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
