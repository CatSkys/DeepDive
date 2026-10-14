// 「上次选择」的传播（用户 2026-10-10 报障）：新会话的模型取自 store.draftModel，
// 而它此前只在**草稿页**选模型时才写——于是"在已有会话里换了模型，新会话却还是老的
// 那个"。模型选择在哪发生都是同一次"上次选择"，所以会话内换模型/改档位也要写回去。
// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setDraftModel = vi.fn();
/** store 的引擎就绪态：可翻，用来复现"挂载时引擎还没起来"那个窗口。 */
let engineUp = true;
vi.mock("../store", () => ({ useStore: () => ({ setDraftModel, engineUp }) }));

const selectModel = vi.fn(async () => ({ selected: { provider: "opencode-go", model: "m2", reasoningEffort: "max" } }));
/** 目录首拉是否落空（引擎未就绪那一下）。 */
let catalogDown = false;
vi.mock("../api", () => ({
  api: {
    selectModel: (...a: unknown[]) => selectModel(...(a as [])),
    modelOptions: async () => {
      if (catalogDown) throw new Error("engine not ready");
      return {
      options: [
        { provider: "opencode-go", model: "m1", label: "M1", providerLabel: "P", efforts: [{ id: "low", name: "Low" }, { id: "max", name: "Max" }], defaultEffort: "low" },
        { provider: "opencode-go", model: "m2", label: "M2", providerLabel: "P", efforts: [{ id: "max", name: "Max" }], defaultEffort: "max" },
      ],
      default: { provider: "opencode-go", model: "m1" },
      };
    },
    sessions: async () => ({
      items: [{ sessionId: "s1", projections: { values: { modelSelection: { next: { provider: "opencode-go", model: "m1", reasoningEffort: "low" } } } } }],
    }),
  },
}));

import { useSessionModels } from "../session/useSessionModels";

let hook: ReturnType<typeof useSessionModels> | null = null;

function Probe() {
  hook = useSessionModels("s1");
  return null;
}

beforeEach(() => {
  setDraftModel.mockClear();
  selectModel.mockClear();
  engineUp = true;
  catalogDown = false;
  hook = null;
});
afterEach(cleanup);

/** 等首屏那次目录/投影加载落地（它是 async effect）。 */
async function settle() {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

describe("会话内换模型 → 写回「上次选择」", () => {
  it("换模型：写回 provider/model + 引擎归一后的档位（新会话据此继承）", async () => {
    render(<Probe />);
    await settle();

    await act(async () => { await hook!.pickModel({ provider: "opencode-go", model: "m2", label: "M2", providerLabel: "P" }); });

    expect(selectModel).toHaveBeenCalledWith({ sessionId: "s1", provider: "opencode-go", model: "m2" });
    expect(setDraftModel).toHaveBeenCalledWith({ provider: "opencode-go", model: "m2", reasoningEffort: "max" });
  });

  it("改档位：模型不变，把档位一起写回（否则新会话会拿到别的档位）", async () => {
    render(<Probe />);
    await settle();

    await act(async () => { await hook!.pickEffort("max"); });

    expect(setDraftModel).toHaveBeenCalledWith({ provider: "opencode-go", model: "m1", reasoningEffort: "max" });
  });

  it("提交失败：不回滚之外也不写「上次选择」（没成功就别污染）", async () => {
    render(<Probe />);
    await settle();
    selectModel.mockRejectedValueOnce(new Error("engine down"));

    await act(async () => { await hook!.pickModel({ provider: "opencode-go", model: "m2", label: "M2", providerLabel: "P" }); });

    expect(setDraftModel).not.toHaveBeenCalled();
  });
});

describe("引擎晚起：目录要在就绪后补拉（用户 2026-10-14「思考强度的开关怎么没了」）", () => {
  // 冷启动与引擎重启的窗口里 modelOptions 会抛，两个 catch 都留空；不重拉的话这个会话的
  // 档位表整场都是空的，输入框那颗档位胶囊（`effort.levels.length > 0` 才渲染）不出现。
  it("挂载时引擎未就绪 → 目录留空；engineUp 翻真后补拉，档位表补上", async () => {
    catalogDown = true;
    engineUp = false;
    const { rerender } = render(<Probe />);
    await settle();
    expect(hook!.effortLevels).toEqual([]);      // 首拉落空＝胶囊此刻不渲染

    catalogDown = false;
    engineUp = true;                             // 引擎就绪（store 翻真 → 组件照常重渲）
    rerender(<Probe />);
    await settle();

    // m1 的档位表回来了（low/max）——胶囊据此出现
    expect(hook!.effortLevels).toEqual([{ id: "low", name: "Low" }, { id: "max", name: "Max" }]);
    expect(hook!.effort).toBe("low");
  });
});
