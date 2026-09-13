// Bot Channel 渠道目录的形状约束：id 唯一、有标签、且每个渠道都拿得到品牌标记
// ——「所有渠道长一样」正是这轮要修的问题，所以把它钉成断言而不是靠自觉。
import { describe, expect, it } from "vitest";
import { IM_CHANNELS, channelLabel, channelLogoKey, botStateTone, provisionPending } from "../bots/im";
import { CHANNEL_LOGOS } from "../bots/channelLogos";

describe("IM_CHANNELS", () => {
  it("id 唯一", () => {
    const ids = IM_CHANNELS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每个渠道都有标签，且能查到", () => {
    for (const c of IM_CHANNELS) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(channelLabel(c.id)).toBe(c.label);
    }
    expect(channelLabel("未知渠道")).toBe("未知渠道");
  });

  it("每个渠道都能解析到品牌标记（无通用图标兜底）", () => {
    for (const c of IM_CHANNELS) {
      const key = channelLogoKey(c.id);
      expect(CHANNEL_LOGOS[key], `${c.id} 缺品牌标记`).toBeDefined();
      expect(CHANNEL_LOGOS[key].paths.length).toBeGreaterThan(0);
      expect(CHANNEL_LOGOS[key].viewBox).toMatch(/^0 0 \d+ \d+$/);
    }
  });
});

describe("状态映射", () => {
  it("botStateTone：连接=on，连接中=warn，其余=off", () => {
    expect(botStateTone("connected")).toBe("on");
    expect(botStateTone("connecting")).toBe("warn");
    expect(botStateTone("offline")).toBe("off");
    expect(botStateTone("error")).toBe("off");
    expect(botStateTone("")).toBe("off");
  });

  it("provisionPending：只有进行中的状态要继续轮询", () => {
    for (const s of ["starting", "pending", "scanned", "needs_verification", "connecting"]) {
      expect(provisionPending(s), s).toBe(true);
    }
    for (const s of ["connected", "expired", "failed", "cancelled"]) {
      expect(provisionPending(s), s).toBe(false);
    }
  });
});
