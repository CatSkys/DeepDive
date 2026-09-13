// 后台会话判据（唯一事实源）的钉子：两层归类 + fail-open + 命名构建器。
// 形态照 MiMo-Code：判据是会话自身的属性（投影标题），不是应用侧 id 台账。
import { describe, expect, it } from "vitest";

import {
  AUTOMATION_PREFIX, CONSOLIDATE_TITLES, EVOLUTION_PREFIX, HOME_TASK_TITLE, REPO_TASK_TITLE,
  automationRunTitle, backgroundTier, isBadgedSession, isHiddenSession,
} from "../session/backgroundSession";
import type { SessionSummary } from "../types";

const s = (title?: string): SessionSummary => ({
  sessionId: "s1",
  updatedAt: 0,
  running: false,
  blank: false,
  ...(title === undefined ? {} : { projections: { asOfSeq: 1, values: { title } } }),
});

describe("backgroundTier", () => {
  it("整理类（复盘/整理）＝ badge：留在列表、加自动标识", () => {
    for (const title of CONSOLIDATE_TITLES) {
      expect(backgroundTier(s(title)), title).toBe("badge");
      expect(isBadgedSession(s(title)), title).toBe(true);
      expect(isHiddenSession(s(title)), title).toBe(false);
    }
  });

  it("执行类（落库会话）＝ hidden：不进用户列表", () => {
    for (const title of [REPO_TASK_TITLE, HOME_TASK_TITLE]) {
      expect(backgroundTier(s(title)), title).toBe("hidden");
      expect(isHiddenSession(s(title)), title).toBe(true);
    }
  });

  it("自动化运行会话＝ hidden（用户定：自动化也算后台）", () => {
    const title = automationRunTitle("提交与风险扫描");
    expect(title).toBe(`${AUTOMATION_PREFIX}提交与风险扫描`);
    expect(backgroundTier(s(title))).toBe("hidden");
  });

  it("用户会话（含近似前缀）不受影响", () => {
    for (const title of ["新会话", "帮我修构建", "自进化", "自动化", "任务 abc123", "自动化巡检"]) {
      expect(backgroundTier(s(title)), title).toBeNull();
    }
    // 前缀必须带分隔符：'自动化巡检' 不是 '自动化·' 开头的后台会话
    expect(backgroundTier(s(`${AUTOMATION_PREFIX}`))).toBe("hidden"); // 空任务名仍属后台
  });

  it("fail-open：无投影/无标题/空标题一律当用户会话（MiMo 同款：宁可多显示）", () => {
    expect(backgroundTier(s())).toBeNull();
    expect(backgroundTier(s(""))).toBeNull();
    expect(backgroundTier(s("   "))).toBeNull();
    expect(backgroundTier({ sessionId: "x", updatedAt: 0, running: false, blank: true })).toBeNull();
  });
});

describe("automationRunTitle", () => {
  it("空任务名回退「运行」，两侧空白裁掉", () => {
    expect(automationRunTitle("   ")).toBe(`${AUTOMATION_PREFIX}运行`);
    expect(automationRunTitle("  每日巡检 ")).toBe(`${AUTOMATION_PREFIX}每日巡检`);
  });

  it("前缀常量是唯一一份（生产者与判据共用）", () => {
    expect(EVOLUTION_PREFIX.endsWith("·")).toBe(true);
    expect(AUTOMATION_PREFIX.endsWith("·")).toBe(true);
    expect(REPO_TASK_TITLE.startsWith(EVOLUTION_PREFIX)).toBe(true);
  });
});
