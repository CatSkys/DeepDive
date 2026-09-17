// 插件页（设置 → 插件）的渲染规格：tab 切换、部署层默认只列已挂载并把未挂载数说清楚、
// 预设成员可按行展开、引擎没有清单接口时报不可用（不冒充空清单）、
// 以及**开关真的把落账写下去**（本页唯一有副作用的动作）。
// 夹具形状取自实机 pluginInventory/list 响应。
// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pluginInventory, pluginPatchList, pluginPatchSet, skillList } = vi.hoisted(() => ({
  pluginInventory: vi.fn(),
  pluginPatchList: vi.fn(),
  pluginPatchSet: vi.fn(),
  skillList: vi.fn(),
}));
vi.mock("../api", () => ({ api: { pluginInventory } }));
// 开关的落账与技能清单都走壳桥；inShell() 为真表示在桌面应用里跑。
vi.mock("../host", () => ({
  inShell: () => true,
  pluginPatchList,
  pluginPatchSet,
  skillList,
  skillCreate: vi.fn(),
  pluginBundledNames: () => Promise.resolve([]),
  pluginUninstall: vi.fn(),
  mcpServersList: () => Promise.resolve({ servers: [], configured: {} }),
  mcpServersSave: vi.fn(),
  restartEngine: vi.fn(),
  skillRemove: vi.fn(),
  revealPath: vi.fn(),
}));
// i18n 的 useT 走 store（这里没有 provider）：注入一个只做 {var} 替换的最小实现，
// 被测的是分区结构而不是词典。**必须返回稳定引用**：真实现按语言缓存闭包
// （i18n.ts 的 tFuncCache），mock 若不稳，组件里 useCallback([t]) 的 effect 会每渲染重跑。
const tFunc = vi.hoisted(() => ({
  lang: "zh" as const,
  t: (s: string) => s,
  tt: (zh: string, _en: string, vars?: Record<string, string | number>) => {
    let out = zh;
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
    return out;
  },
}));
vi.mock("../i18n", () => ({ useT: () => tFunc }));

import { PluginsSection } from "../plugins/PluginsSection";

afterEach(cleanup);

beforeEach(() => {
  onTryPlugin.mockClear();
  pluginPatchList.mockResolvedValue([]);
  pluginPatchSet.mockResolvedValue({ ok: true });
  skillList.mockResolvedValue([]);
});

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

const onTryPlugin = vi.fn();

describe("插件页", () => {
  it("部署层列出已挂载模块，并把未挂载的数量与展开入口说清楚", async () => {
    pluginInventory.mockResolvedValue(fixture());
    const { container, getByText } = render(<PluginsSection onTryPlugin={onTryPlugin} />);
    await waitFor(() => expect(container.textContent).toContain("llm"));
    // 未挂载的那行默认不列（只报数量），点展开才出现
    expect(container.textContent).not.toContain("tool-bash");
    expect(container.textContent).toContain("另有 1 个模块在本层未挂载");
    getByText("展开全部").click();
    await waitFor(() => expect(container.textContent).toContain("tool-bash"));
  });

  it("挂载中的行给开关，未挂载的行只给状态文字（拨了也是空操作）", async () => {
    pluginInventory.mockResolvedValue(fixture());
    const { container, getAllByRole, getByText } = render(<PluginsSection onTryPlugin={onTryPlugin} />);
    await waitFor(() => expect(container.textContent).toContain("llm"));
    // 已挂载的 llm 行有真开关
    expect(getAllByRole("switch")).toHaveLength(1);
    expect(getAllByRole("switch")[0].getAttribute("aria-checked")).toBe("true");
    // 展开后未挂载的那行只有状态文字，不出现第二个开关
    getByText("展开全部").click();
    await waitFor(() => expect(container.textContent).toContain("本层未挂载"));
    expect(getAllByRole("switch")).toHaveLength(1);
  });

  it("拨开关把落账写下去，落的是行 id 而不是 entryId", async () => {
    pluginInventory.mockResolvedValue(fixture());
    const { container, getByRole } = render(<PluginsSection onTryPlugin={onTryPlugin} />);
    await waitFor(() => expect(container.textContent).toContain("llm"));
    getByRole("switch").click();
    await waitFor(() => expect(pluginPatchSet).toHaveBeenCalledWith("llm", true));
  });

  it("落账里已关掉的行开关呈关闭态（与「本层未挂载」分开：它仍可拨回去）", async () => {
    pluginInventory.mockResolvedValue(fixture());
    pluginPatchList.mockResolvedValue([{ rowId: "llm", disabled: true }]);
    const { container, getByRole } = render(<PluginsSection onTryPlugin={onTryPlugin} />);
    await waitFor(() => expect(getByRole("switch").getAttribute("aria-checked")).toBe("false"));
    expect(container.textContent).toContain("llm");
  });

  it("预设成员默认收起，展开后能看到工具的真实状态（活跃）", async () => {
    pluginInventory.mockResolvedValue(fixture());
    const { container, getByText } = render(<PluginsSection onTryPlugin={onTryPlugin} />);
    await waitFor(() => expect(container.textContent).toContain("standard"));
    expect(container.textContent).not.toContain("@deepseek-ai/dsh-pwsh-sandbox");
    getByText("standard").closest("button")!.click();
    await waitFor(() => expect(container.textContent).toContain("@deepseek-ai/dsh-pwsh-sandbox"));
    // 预设里 tool-bash 是 active —— 这正是"工具看预设、不看部署层"的实证
    expect(container.textContent).toContain("已启用");
  });

  it("引擎没有清单接口时报不可用，而不是冒充空清单", async () => {
    pluginInventory.mockRejectedValue(new Error("HTTP 404"));
    const { container } = render(<PluginsSection onTryPlugin={onTryPlugin} />);
    await waitFor(() => expect(container.textContent).toContain("引擎未连接"));
    expect(container.textContent).not.toContain("已安装");
  });

  it("技能在另一个 tab 里：默认不渲染，点过去才出现", async () => {
    pluginInventory.mockResolvedValue(fixture());
    const { container, getByText } = render(<PluginsSection onTryPlugin={onTryPlugin} />);
    await waitFor(() => expect(container.textContent).toContain("llm"));
    expect(container.textContent).not.toContain("还没有自建技能");
    getByText("技能").click();
    await waitFor(() => expect(container.textContent).toContain("还没有自建技能"));
  });

  it("行菜单的「立即试用」把模块名交给上层（预填草稿由上层做）", async () => {
    pluginInventory.mockResolvedValue(fixture());
    const { container, getAllByLabelText, getByText } = render(<PluginsSection onTryPlugin={onTryPlugin} />);
    await waitFor(() => expect(container.textContent).toContain("llm"));
    getAllByLabelText("更多")[0].click();
    await waitFor(() => expect(getByText("立即试用")).toBeTruthy());
    getByText("立即试用").click();
    expect(onTryPlugin).toHaveBeenCalledWith("@deepseek-ai/dsh-llm");
  });

  it("内置引擎模块不给卸载入口（删了也会被随包发布装回来）", async () => {
    pluginInventory.mockResolvedValue(fixture());
    const { container, getAllByLabelText, queryByText } = render(<PluginsSection onTryPlugin={onTryPlugin} />);
    await waitFor(() => expect(container.textContent).toContain("llm"));
    getAllByLabelText("更多")[0].click();
    await waitFor(() => expect(queryByText("立即试用")).toBeTruthy());
    expect(queryByText("卸载")).toBeNull();
  });
});
