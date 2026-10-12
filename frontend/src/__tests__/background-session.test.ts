// 后台会话判据（唯一事实源）的钉子：归类 + fail-open + 命名构建器。
// 形态照 MiMo-Code：判据是会话自身的属性（投影标题），不是应用侧 id 台账。
import { describe, expect, it } from "vitest";

import {
  AUTOMATION_PREFIX, LEGACY_EVOLUTION_PREFIX, automationRunTitle, isHiddenSession, isQuietSession, titleHidesSession,
} from "../session/backgroundSession";
import type { SessionSummary } from "../types";

const s = (title?: string, origin?: "subagent"): SessionSummary => ({
  sessionId: "s1",
  updatedAt: 0,
  running: false,
  blank: false,
  ...(title === undefined ? {} : { projections: { asOfSeq: 1, values: { title } } }),
  ...(origin === undefined ? {} : { origin }),
});

describe("isHiddenSession", () => {
  it("自动化运行会话＝ hidden（用户定：自动化也算后台）", () => {
    const title = automationRunTitle("提交与风险扫描");
    expect(title).toBe(`${AUTOMATION_PREFIX}提交与风险扫描`);
    expect(isHiddenSession(s(title))).toBe(true);
  });

  it("用户会话（含近似前缀）不受影响", () => {
    for (const title of ["新会话", "帮我修构建", "自动化", "任务 abc123", "自动化巡检"]) {
      expect(isHiddenSession(s(title)), title).toBe(false);
    }
    // 前缀必须带分隔符：'自动化巡检' 不是 '自动化·' 开头的后台会话
    expect(isHiddenSession(s(`${AUTOMATION_PREFIX}`))).toBe(true); // 空任务名仍属后台
  });

  it("已删除的「自进化」留下的机器会话仍不进用户列表（判据留着，生产者没了）", () => {
    expect(isHiddenSession(s(`${LEGACY_EVOLUTION_PREFIX}落库`))).toBe(true);
    expect(isHiddenSession(s(`${LEGACY_EVOLUTION_PREFIX}复盘`))).toBe(true);
  });

  it("fail-open：无投影/无标题/空标题一律当用户会话（MiMo 同款：宁可多显示）", () => {
    expect(isHiddenSession(s())).toBe(false);
    expect(isHiddenSession(s(""))).toBe(false);
    expect(isHiddenSession(s("   "))).toBe(false);
    expect(isHiddenSession({ sessionId: "x", updatedAt: 0, running: false, blank: true })).toBe(false);
  });
});

describe("automationRunTitle", () => {
  it("空任务名回退「运行」，两侧空白裁掉", () => {
    expect(automationRunTitle("   ")).toBe(`${AUTOMATION_PREFIX}运行`);
    expect(automationRunTitle("  每日巡检 ")).toBe(`${AUTOMATION_PREFIX}每日巡检`);
  });

  it("前缀常量是唯一一份（生产者与判据共用）", () => {
    expect(AUTOMATION_PREFIX.endsWith("·")).toBe(true);
  });
});

describe("titleHidesSession（改名准入）", () => {
  it("改名成后台保留前缀会隐藏会话——入口据此先问一句", () => {
    expect(titleHidesSession(`${AUTOMATION_PREFIX}每日报告`)).toBe(true);
    expect(titleHidesSession(`${LEGACY_EVOLUTION_PREFIX}落库`)).toBe(true);
  });

  it("普通名字不隐藏", () => {
    expect(titleHidesSession("修登录 bug")).toBe(false);
    expect(titleHidesSession("  ")).toBe(false);
  });
});

describe("isQuietSession（壳侧 quiet 集的判据）", () => {
  it("子代理派生会话（origin=subagent）＝ quiet：结束不发系统通知（用户 2026-10-12 定稿）", () => {
    expect(isQuietSession(s(undefined, "subagent"))).toBe(true);
    expect(isQuietSession(s("调研今日科技/AI资讯", "subagent"))).toBe(true);
  });

  it("自动化运行会话照旧 quiet；正式会话不 quiet（标题判据 + origin 双源都收敛到这里）", () => {
    expect(isQuietSession(s(automationRunTitle("每日巡检")))).toBe(true);
    expect(isQuietSession(s("新会话"))).toBe(false);
    expect(isQuietSession(s())).toBe(false); // fail-open 同口径
  });
});
