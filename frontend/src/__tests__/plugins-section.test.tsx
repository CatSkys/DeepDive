// 技能与插件分区的渲染规格（夹具形状取自实机 pluginInventory/list 响应）：
// 预设卡片列出成员并可按行展开、部署层默认只列已挂载并把未挂载数说清楚、
// 技能卡在浏览器里显式说不可用（没有壳桥时不冒充空列表）。
// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { pluginInventory } = vi.hoisted(() => ({ pluginInventory: vi.fn() }));
vi.mock("../api", () => ({ api: { pluginInventory } }));
// i18n 的 useT 走 store（这里没有 provider）：注入一个只做 {var} 替换的最小实现，
// 被测的是分区结构而不是词典。
vi.mock("../i18n", () => ({
  useT: () => ({
    lang: "zh" as const,
    t: (s: string) => s,
    tt: (zh: string, _en: string, vars?: Record<string, string | number>) => {
      let out = zh;
      if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
      return out;
    },
  }),
}));

import { PluginsSection } from "../plugins/PluginsSection";

afterEach(cleanup);

function fixture() {
  return {
    entries: [
      { entryId: "include:llm", moduleName: "@deepseek-ai/dsh-llm", enabled: true, fiberPhase: "active" as const },
      { entryId: "include:tool-bash", moduleName: "@deepseek-ai/dsh-tool-bash", enabled: false, fiberPhase: null },
    ],
    agentPresets: [
      {
        id: "standard", trust: "system" as const, isDefault: true,
        rows: [
          { entryId: "tool-bash", moduleName: "@deepseek-ai/dsh-tool-bash", enabled: true, fiberPhase: "active" as const },
          { entryId: "pwsh-sandbox", moduleName: "@deepseek-ai/dsh-pwsh-sandbox", enabled: false, fiberPhase: null },
        ],
      },
    ],
  };
}

describe("技能与插件分区", () => {
  it("部署层列出已挂载模块，并把未挂载的数量与展开入口说清楚", async () => {
    pluginInventory.mockResolvedValue(fixture());
    const { container, getByText } = render(<PluginsSection />);
    await waitFor(() => expect(container.textContent).toContain("dsh-llm"));
    // 未挂载的那行默认不列（只报数量），点展开才出现
    expect(container.textContent).not.toContain("include:tool-bash");
    expect(container.textContent).toContain("另有 1 个模块在本层未挂载");
    getByText("展开全部").click();
    await waitFor(() => expect(container.textContent).toContain("include:tool-bash"));
  });

  it("预设成员默认收起，展开后能看到工具的真实状态（活跃）", async () => {
    pluginInventory.mockResolvedValue(fixture());
    const { container, getByText } = render(<PluginsSection />);
    await waitFor(() => expect(container.textContent).toContain("standard"));
    expect(container.textContent).not.toContain("@deepseek-ai/dsh-pwsh-sandbox");
    getByText("standard").closest("button")!.click();
    await waitFor(() => expect(container.textContent).toContain("@deepseek-ai/dsh-pwsh-sandbox"));
    // 预设里 tool-bash 是 active —— 这正是"工具看预设、不看部署层"的实证
    const presetCard = container.textContent ?? "";
    expect(presetCard).toContain("已启用");
    expect(presetCard).toContain("本层未挂载");
  });

  it("引擎没有清单接口时报不可用，而不是冒充空清单", async () => {
    pluginInventory.mockRejectedValue(new Error("HTTP 404"));
    const { container } = render(<PluginsSection />);
    await waitFor(() => expect(container.textContent).toContain("引擎未连接"));
    expect(container.textContent).not.toContain("部署层模块（0 个");
  });

  it("没有壳桥时技能卡说明只有桌面应用能读", async () => {
    pluginInventory.mockResolvedValue(fixture());
    const { container } = render(<PluginsSection />);
    await waitFor(() => expect(container.textContent).toContain("只有桌面应用能读写"));
  });
});
