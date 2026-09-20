// 新手引导的进度状态：持久部分存壳偏好（`deepdive.onboarding`，JSON 串；见 prefs.ts），
// 步骤"完成"尽量靠可观测事实派生（密钥/项目空间），存储只记"用户走到哪"。
//
// 出现条件（沿用旧首启门的红线：读失败绝不冒充"未配置"）：
//  · 一个密钥都没配（正向确证）→ 无论如何都出现（没密钥的应用不可用）；
//  · 否则只在"用户已经走到第 2 步之后"且没跳过/没完成时继续出现——老用户（有密钥、
//    有项目、有会话）不会被升级后突然弹一脸引导。
import { useCallback, useMemo } from "react";
import { useStore } from "../store";
import { usePrefs } from "../prefs";
import { useModelCatalog } from "../settings/useModelCatalog";

/** 步骤顺序（用户定稿：迁移在最前——能一次把会话与模型配置都带进来）。 */
export const ONBOARDING_STEPS = ["migrate", "model", "project", "done"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingState {
  /** 当前步（1..4）。 */
  step: number;
  /** 用户按过「跳过引导」：有密钥之后不再打扰。 */
  skipped: boolean;
  /** 走完结尾语。 */
  done: boolean;
}

const DEFAULT_STATE: OnboardingState = { step: 1, skipped: false, done: false };

/** 壳偏好里的 JSON 串 → 状态；坏值/缺省一律回默认（与 readPref 同策略）。 */
export function parseOnboarding(raw: string): OnboardingState {
  if (!raw) return DEFAULT_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    const step = typeof parsed.step === "number" && parsed.step >= 1 && parsed.step <= ONBOARDING_STEPS.length
      ? Math.floor(parsed.step) : 1;
    return { step, skipped: parsed.skipped === true, done: parsed.done === true };
  } catch {
    return DEFAULT_STATE;
  }
}

export function serializeOnboarding(state: OnboardingState): string {
  return JSON.stringify(state);
}

export interface OnboardingView {
  visible: boolean;
  state: OnboardingState;
  stepIndex: number;
  step: OnboardingStepId;
  /** 各步是否已完成（派生，供左栏进度打勾）。 */
  completed: Record<OnboardingStepId, boolean>;
  setStep: (index: number) => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  finish: () => void;
}

/** 卡片是否出现（纯函数，回归钉在 __tests__/onboarding-state.test.ts）：
 *  · 引擎连上之前不出现（那几秒归启动骨架屏，不然卡片会盖在骨架上）；
 *  · 一个密钥都没配（正向确证）→ 无论如何都出现（没密钥的应用不可用）；
 *  · 否则只在"已经走到第 2 步之后"且没跳过/没完成时继续出现——老用户（有密钥、有
 *    项目、有会话）不会被升级后突然弹一脸引导。 */
export function onboardingVisible(input: {
  engineUp: boolean;
  noKey: boolean;
  freshGap: boolean;
  state: OnboardingState;
}): boolean {
  const { engineUp, noKey, freshGap, state } = input;
  if (!engineUp) return false;
  if (noKey) return true;
  return !state.skipped && !state.done && (state.step > 1 || freshGap);
}

export function useOnboarding(options: { forced?: boolean } = {}): OnboardingView {
  const store = useStore();
  const { onboarding, setOnboarding } = usePrefs();
  const cat = useModelCatalog();

  const state = useMemo(() => parseOnboarding(onboarding), [onboarding]);
  const write = useCallback((next: OnboardingState) => setOnboarding(serializeOnboarding(next)), [setOnboarding]);

  const noKey = cat.configuredKnown && !cat.anyConfigured;
  const hasProject = store.workspaces.length > 0;
  // 「全新」= 既没有项目空间也没有任何会话：升级上来的老用户两者都有，不会被弹。
  const freshGap = !hasProject && store.sessions.length === 0;
  // 强制打开（帮助菜单入口）：与自动出现并列，不走自动条件——用户主动要看的。
  const visible = options.forced === true || onboardingVisible({ engineUp: store.engineUp, noKey, freshGap, state });

  // 步 2 的完成以密钥为准（可观测）；迁移步按"已走过"记（它没有可观测结果）。
  const completed: Record<OnboardingStepId, boolean> = {
    migrate: state.step > 1,
    model: cat.anyConfigured,
    project: hasProject,
    done: state.done,
  };

  const stepIndex = Math.min(Math.max(state.step, 1), ONBOARDING_STEPS.length) - 1;
  const goto = useCallback((index: number) => {
    const clamped = Math.min(Math.max(index, 0), ONBOARDING_STEPS.length - 1);
    write({ ...state, step: clamped + 1 });
  }, [state, write]);

  return {
    visible,
    state,
    stepIndex,
    step: ONBOARDING_STEPS[stepIndex],
    completed,
    setStep: goto,
    next: () => goto(stepIndex + 1),
    back: () => goto(stepIndex - 1),
    skip: () => write({ ...state, skipped: true }),
    finish: () => write({ ...state, done: true, step: ONBOARDING_STEPS.length }),
  };
}
