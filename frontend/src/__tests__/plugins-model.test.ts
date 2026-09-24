// 技能与插件分区的纯逻辑规格。状态模型的关键点：`enabled:false` 只能读成「本层未挂载」
// ——实测 Loader 层 27 行如此，而它们（tool-bash / tool-fs / skill-filesystem…）在应用里
// 明明可用，因为工具真正挂在 agent preset 组合里。把这条钉住，免得有人再把它当"用户关掉了"。
import { describe, expect, it } from "vitest";
import type { PluginFiberPhase } from "../api";
import { isBundledModule, pluginState, sortPluginRows, type PluginRowLike } from "../plugins/model";

function row(
  entryId: string | null,
  moduleName: string,
  enabled: PluginRowLike["enabled"],
  fiberPhase: PluginFiberPhase = null,
): PluginRowLike {
  return { entryId, moduleName, enabled, fiberPhase };
}

describe("pluginState", () => {
  it("enabled:false 是「本层未挂载」，优先于相位", () => {
    expect(pluginState(row("include:tool-bash", "tool-bash", false))).toBe("off");
    expect(pluginState(row("include:tool-bash", "tool-bash", false, "active"))).toBe("off");
  });

  it("!!js 行如实报「按条件启用」，不猜开关", () => {
    expect(pluginState(row("x", "x", "conditional", "active"))).toBe("conditional");
  });

  it("相位映射：active/failed 直达，加载中的三种态算启动中，启用但无 fiber 是未运行", () => {
    expect(pluginState(row("a", "a", true, "active"))).toBe("active");
    expect(pluginState(row("a", "a", true, "failed"))).toBe("failed");
    expect(pluginState(row("a", "a", true, "loading"))).toBe("starting");
    expect(pluginState(row("a", "a", true, "pending"))).toBe("starting");
    expect(pluginState(row("a", "a", true, "unloading"))).toBe("starting");
    expect(pluginState(row("a", "a", true, null))).toBe("idle");
  });
});

describe("sortPluginRows", () => {
  it("按模块名排序、同名按 entryId，且不改入参", () => {
    const input = [row("include:z", "web-search", true), row("include:a", "dsh-base", true), row("include:b", "dsh-base", true)];
    expect(sortPluginRows(input).map((r) => r.entryId)).toEqual(["include:a", "include:b", "include:z"]);
    expect(input.map((r) => r.entryId)).toEqual(["include:z", "include:a", "include:b"]);
  });

  it("entryId 为 null 的行不炸（按模块名排序）", () => {
    const input = [row(null, "b-tool", true), row(null, "a-tool", true)];
    expect(sortPluginRows(input).map((r) => r.moduleName)).toEqual(["a-tool", "b-tool"]);
  });
});

describe("isBundledModule", () => {
  it("引擎自带的内部模块与用户装进来的插件分得开", () => {
    expect(isBundledModule("@deepseek-ai/dsh-llm")).toBe(true);
    expect(isBundledModule("cordis:hmr")).toBe(true);
    expect(isBundledModule("@everos-ai/dsh-plugin")).toBe(false);
    expect(isBundledModule("dsh-chat-import")).toBe(false);
  });
});
