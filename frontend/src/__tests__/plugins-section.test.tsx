// 插件页（设置 → 插件）的渲染规格：只列用户可安装的插件（引擎自带的内部模块不出现，
// 但把隐去的数量说清楚）、tab 切换、可拨的行给开关而不可拨的只给状态文字、
// 引擎没有清单接口时报不可用（不冒充空清单）、以及**开关真的把落账写下去**（本页唯一
// 有副作用的动作）。夹具形状取自实机 pluginInventory/list 响应。
// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pluginInventory, pluginPatchList, pluginPatchSet, skillsAdminList } = vi.hoisted(() => ({
  pluginInventory: vi.fn(),
  pluginPatchList: vi.fn(),
  pluginPatchSet: vi.fn(),
  skillsAdminList: vi.fn(),
}));
// 清单、落账、技能读写全在引擎侧（`pluginInventory/*`、`skills/admin*`），只有
// "哪些插件随应用发布"与选目录 sheet 留在壳上。
vi.mock("../api", () => ({
  api: {
    pluginInventory,
    pluginPatchList,
    pluginPatchSet,
    skillsAdmin: { list: skillsAdminList },
  },
}));
vi.mock("../host", () => ({
  inShell: () => true,
  pluginBundledNames: () => Promise.resolve(["dsh-chat-import"]),
  pluginUninstall: vi.fn(),
  mcpServersList: () => Promise.resolve({ servers: [], configured: {} }),
  mcpServersSave: vi.fn(),
  restartEngine: vi.fn(),
  appSkillNames: () => Promise.resolve([]),
  skillPickDirectory: vi.fn(),
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
  pluginPatchList.mockResolvedValue({ toggles: [] });
  pluginPatchSet.mockResolvedValue({ ok: true });
  skillsAdminList.mockResolvedValue({ skills: [] });
});

// 一个用户装的插件（活跃）、一个用户装但本层未挂载的（随应用发布）、两个引擎自带模块。
function fixture() {
  return {
    entries: [
      { entryId: "include:llm", moduleName: "@deepseek-ai/dsh-llm", enabled: true, fiberPhase: "active" as const },
      { entryId: "include:tool-bash", moduleName: "@deepseek-ai/dsh-tool-bash", enabled: false, fiberPhase: null },
      { entryId: "include:everos", moduleName: "@everos-ai/dsh-plugin", enabled: true, fiberPhase: "active" as const },
      { entryId: "include:chat-import", moduleName: "dsh-chat-import", enabled: false, fiberPhase: null },
    ],
  };
}

const onTryPlugin = vi.fn();

describe("插件页", () => {
  it("只列用户装的插件：引擎自带的内部模块一行都不出现", async () => {
    pluginInventory.mockResolvedValue(fixture());
    const { container } = render(<PluginsSection onTryPlugin={onTryPlugin} />);
    await waitFor(() => expect(container.textContent).toContain("@everos-ai/dsh-plugin"));
    expect(container.textContent).toContain("已安装（2）");
    expect(container.textContent).not.toContain("llm");
    expect(container.textContent).not.toContain("tool-bash");
  });

  it("一个用户插件都没有时说清楚是空的，而不是显示引擎模块凑数", async () => {
    pluginInventory.mockResolvedValue({ entries: fixture().entries.slice(0, 2) });
    const { container } = render(<PluginsSection onTryPlugin={onTryPlugin} />);
    await waitFor(() => expect(container.textContent).toContain("还没有安装第三方插件"));
  });

  it("挂载中的行给开关，本层未挂载的行只给状态文字（拨了也是空操作）", async () => {
    pluginInventory.mockResolvedValue(fixture());
    const { container, getAllByRole } = render(<PluginsSection onTryPlugin={onTryPlugin} />);
    await waitFor(() => expect(container.textContent).toContain("@everos-ai/dsh-plugin"));
    // 只有活跃的那行有真开关
    expect(getAllByRole("switch")).toHaveLength(1);
    expect(getAllByRole("switch")[0].getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).toContain("本层未挂载");
  });

  it("拨开关把落账写下去，落的是行 id 而不是 entryId", async () => {
    pluginInventory.mockResolvedValue(fixture());
    const { container, getByRole } = render(<PluginsSection onTryPlugin={onTryPlugin} />);
    await waitFor(() => expect(container.textContent).toContain("@everos-ai/dsh-plugin"));
    getByRole("switch").click();
    await waitFor(() => expect(pluginPatchSet).toHaveBeenCalledWith("everos", true));
  });

  it("落账里已关掉的行开关呈关闭态（与「本层未挂载」分开：它仍可拨回去）", async () => {
    pluginInventory.mockResolvedValue(fixture());
    pluginPatchList.mockResolvedValue({ toggles: [{ rowId: "everos", disabled: true }] });
    const { container, getByRole } = render(<PluginsSection onTryPlugin={onTryPlugin} />);
    await waitFor(() => expect(getByRole("switch").getAttribute("aria-checked")).toBe("false"));
    expect(container.textContent).toContain("@everos-ai/dsh-plugin");
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
    await waitFor(() => expect(container.textContent).toContain("@everos-ai/dsh-plugin"));
    expect(container.textContent).not.toContain("还没有自建技能");
    getByText("技能").click();
    await waitFor(() => expect(container.textContent).toContain("还没有自建技能"));
  });

  it("行菜单的「立即试用」把模块名交给上层（预填草稿由上层做）", async () => {
    pluginInventory.mockResolvedValue(fixture());
    const { container, getAllByLabelText, getByText } = render(<PluginsSection onTryPlugin={onTryPlugin} />);
    await waitFor(() => expect(container.textContent).toContain("@everos-ai/dsh-plugin"));
    getAllByLabelText("更多")[0].click();
    await waitFor(() => expect(getByText("立即试用")).toBeTruthy());
    getByText("立即试用").click();
    expect(onTryPlugin).toHaveBeenCalledWith("@everos-ai/dsh-plugin");
  });

  it("随应用发布的行不给卸载入口（删了也会被随包发布装回来），用户装的有", async () => {
    pluginInventory.mockResolvedValue(fixture());
    const { container, getAllByLabelText, getByText, queryByText } = render(<PluginsSection onTryPlugin={onTryPlugin} />);
    await waitFor(() => expect(container.textContent).toContain("@everos-ai/dsh-plugin"));
    // 第一行是 @everos-ai/dsh-plugin（用户装的）：可卸载
    getAllByLabelText("更多")[0].click();
    await waitFor(() => expect(queryByText("卸载")).toBeTruthy());
    // 关掉菜单，再看第二行 dsh-chat-import（随应用发布）：只剩「立即试用」
    getByText("立即试用").click();
    getAllByLabelText("更多")[1].click();
    await waitFor(() => expect(queryByText("立即试用")).toBeTruthy());
    expect(queryByText("卸载")).toBeNull();
  });
});
