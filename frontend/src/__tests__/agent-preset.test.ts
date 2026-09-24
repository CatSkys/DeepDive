// 会话模式呈现面的两件事：开放清单过滤（引擎随包 ptc/cordis 不呈现）与
// 展示名（内建走双语词典、用户自建保留引擎原文）。
import { describe, expect, it } from "vitest";
import type { AgentPreset } from "../api";
import { agentPresetLabel, visibleAgentPresets } from "../settings/agentPreset";

const ROSTER: AgentPreset[] = [
  { id: "standard", name: "标准模式", trust: "system", isDefault: true },
  { id: "ptc", name: "PTC 模式", trust: "system" },
  { id: "minimal", name: "极简模式", trust: "system" },
  { id: "cordis", name: "创造模式", trust: "system" },
  { id: "my-agent", name: "我的模式", trust: "user" },
];

describe("visibleAgentPresets", () => {
  it("只留开放清单里的，且按清单顺序而非引擎名录顺序", () => {
    expect(visibleAgentPresets(ROSTER).map((p) => p.id)).toEqual(["standard", "minimal"]);
  });
  it("引擎名录为空时返回空（设置页据此整块不渲染）", () => {
    expect(visibleAgentPresets([])).toEqual([]);
  });
  it("对 {id,label} 形态同样适用（机器人设置的预设列表）", () => {
    const imRows = [{ id: "ptc", label: "PTC 模式" }, { id: "standard", label: "标准模式" }];
    expect(visibleAgentPresets(imRows).map((r) => r.id)).toEqual(["standard"]);
  });
});

describe("agentPresetLabel", () => {
  it("内建预设走词典（中文源串随 UI 语言切换）", () => {
    expect(agentPresetLabel(ROSTER[0]!)).toBe("标准");
    expect(agentPresetLabel(ROSTER[2]!)).toBe("极简");
  });
  it("用户自建预设保留引擎文本", () => {
    expect(agentPresetLabel(ROSTER[4]!)).toBe("我的模式");
  });
  it("引擎没给 name 时退回 id", () => {
    expect(agentPresetLabel({ id: "my-agent", trust: "user" })).toBe("my-agent");
  });
});
