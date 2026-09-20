// 新手引导：状态解析与出现条件的回归钉。都是纯函数——出现条件的红线有三条，钉死：
// 引擎没连上不出现（归属启动骨架屏）、没配密钥必出现、老用户（有密钥+有项目+有会话）
// 不被打扰。
import { describe, expect, it } from "vitest";
import { onboardingVisible, parseOnboarding, serializeOnboarding } from "../onboarding/useOnboarding";

describe("引导状态解析", () => {
  it("缺省/坏值一律回默认（第一步、未跳过、未完成）", () => {
    expect(parseOnboarding("")).toEqual({ step: 1, skipped: false, done: false });
    expect(parseOnboarding("not json")).toEqual({ step: 1, skipped: false, done: false });
    expect(parseOnboarding('{"step":"3"}')).toEqual({ step: 1, skipped: false, done: false });
  });

  it("步序夹在 1..4，布尔按 true 认", () => {
    expect(parseOnboarding('{"step":3,"skipped":true,"done":false}')).toEqual({ step: 3, skipped: true, done: false });
    // 越界视为坏值 → 回默认（不是夹到边界：存进来的值只有本前端写，越界即数据坏了）
    expect(parseOnboarding('{"step":99}').step).toBe(1);
    expect(parseOnboarding('{"step":0}').step).toBe(1);
  });

  it("往返不丢字段", () => {
    const state = { step: 2, skipped: false, done: true };
    expect(parseOnboarding(serializeOnboarding(state))).toEqual(state);
  });
});

describe("引导卡出现条件", () => {
  const fresh = { step: 1, skipped: false, done: false };

  it("引擎没连上不出现（那几秒归启动骨架屏）", () => {
    expect(onboardingVisible({ engineUp: false, noKey: true, freshGap: true, state: fresh })).toBe(false);
  });

  it("没配密钥必出现（跳过过也出现：没密钥的应用不可用）", () => {
    expect(onboardingVisible({ engineUp: true, noKey: true, freshGap: false, state: fresh })).toBe(true);
    expect(onboardingVisible({ engineUp: true, noKey: true, freshGap: false, state: { ...fresh, skipped: true, done: true } })).toBe(true);
  });

  it("全新（无项目无会话）出现；老用户（有项目或会话）不出现", () => {
    expect(onboardingVisible({ engineUp: true, noKey: false, freshGap: true, state: fresh })).toBe(true);
    expect(onboardingVisible({ engineUp: true, noKey: false, freshGap: false, state: fresh })).toBe(false);
  });

  it("中途退出可续：走到第 2 步之后仍出现，跳过/完成后不再出现", () => {
    expect(onboardingVisible({ engineUp: true, noKey: false, freshGap: false, state: { step: 2, skipped: false, done: false } })).toBe(true);
    expect(onboardingVisible({ engineUp: true, noKey: false, freshGap: false, state: { step: 2, skipped: true, done: false } })).toBe(false);
    expect(onboardingVisible({ engineUp: true, noKey: false, freshGap: false, state: { step: 3, skipped: false, done: true } })).toBe(false);
  });
});
