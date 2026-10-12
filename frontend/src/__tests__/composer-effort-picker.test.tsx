// 思考强度（档位）与模型选择拆开后的两条写路（用户 2026-10-09 定稿）：
//   · ModelMenu 只管选模型——点模型即提交并关闭，菜单里**不再有档位第二层**；
//   · 档位是输入框上那颗胶囊（components/composer/EffortPicker）——弹层单选、
//     选中打勾、点选即提交并关闭，⇧⌘E 经 dd:cycle-effort 事件循环到下一档。
// 这几条钉住"档位不再搭模型菜单的车"，也钉住胶囊本身的开合与提交口径。
// @vitest-environment jsdom
import { createRef, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelMenu, type ModelOption } from "../components/ModelMenu";
import { EffortPicker } from "../components/composer/EffortPicker";
import { DD_EVENTS, dispatchAppEvent } from "../events";

// jsdom 不实现 matchMedia（prefs.ts 初始化外观要用），补标准 stub
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

vi.mock("../store", () => ({ useStore: () => ({ lang: "zh", keybinds: undefined }) }));

afterEach(cleanup);

const LEVELS = [{ id: "low", name: "Low" }, { id: "high", name: "High" }, { id: "max", name: "Max" }];

const FLASH: ModelOption = {
  provider: "deepseek",
  model: "v41-flash",
  label: "DeepSeek-V41-Flash",
  providerLabel: "DeepSeek",
  efforts: LEVELS,
  defaultEffort: "high",
};

const PLAIN: ModelOption = { provider: "openai", model: "gpt", label: "GPT-4o", providerLabel: "OpenAI" };

function setupMenu(over: Partial<ComponentProps<typeof ModelMenu>> = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  // 弹层按触发器 rect 定位（挂 body）：测试里给一个真实触发钮
  const anchorRef = createRef<HTMLButtonElement>();
  render(
    <>
      <button ref={anchorRef} type="button">模型</button>
      <ModelMenu
        options={[FLASH, PLAIN]}
        current="GPT-4o"
        currentModel={{ provider: "openai", model: "gpt" }}
        onPick={onPick}
        onClose={onClose}
        anchorRef={anchorRef}
        {...over}
      />
    </>,
  );
  return { onPick, onClose };
}

describe("模型菜单 · 只选模型", () => {
  it("点带档位的模型：提交模型并关闭，菜单里不再进档位第二层", () => {
    const { onPick, onClose } = setupMenu();
    fireEvent.click(screen.getByText("DeepSeek-V41-Flash"));

    expect(onPick).toHaveBeenCalledWith(FLASH);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
  });

  it("点无档位模型：同样提交并关闭（两条路径同一口径）", () => {
    const { onPick, onClose } = setupMenu();
    // 基准详情默认开（用户 2026-10-11 定稿）：卡上也有一份当前选择名，点菜单行
    fireEvent.click(screen.getAllByText("GPT-4o")[0]);

    expect(onPick).toHaveBeenCalledWith(PLAIN);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("输入框 · 思考强度胶囊", () => {
  function setupPicker(over: Partial<ComponentProps<typeof EffortPicker>> = {}) {
    const pick = vi.fn();
    render(<EffortPicker levels={LEVELS} value="high" pick={pick} {...over} />);
    return { pick };
  }

  it("触发钮显示当前档位名", () => {
    setupPicker();
    expect(screen.getByRole("button", { name: /High/ })).toBeTruthy();
  });

  // 显示口径（用户 2026-10-10 定稿）：有引擎给的推荐值就显示推荐值；没有则取档位表里
  // **最高**的一档——任何情况下都不许显示为空。引擎侧同时被要求补齐事实源
  // （llm-pi-ai 的 describableReasoningLevel 兜底到最高档并真的发出去，见
  // PITFALLS §7.11），所以这条前端兜底是第二道保险，不是常态。
  it("引擎没报生效档：显示档位表里最高的一档，不留空", () => {
    setupPicker({ value: undefined });
    expect(screen.getByRole("button", { name: /Max/ })).toBeTruthy();
  });

  it("兜底显示最高档时，弹层里勾的也是那一档", () => {
    setupPicker({ value: undefined });
    fireEvent.click(screen.getByRole("button", { name: /Max/ }));

    const radios = screen.getAllByRole("menuitemradio");
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
  });

  it("点当前显示的那一档不提交（没得可改）", () => {
    const { pick } = setupPicker({ value: undefined });
    fireEvent.click(screen.getByRole("button", { name: /Max/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Max" }));

    expect(pick).not.toHaveBeenCalled();
  });

  it("引擎报了一个不在表里的档：不认它，同样退到最高档", () => {
    setupPicker({ value: "turbo" });
    expect(screen.getByRole("button", { name: /Max/ })).toBeTruthy();
  });

  it("引擎报了推荐值：显示推荐值，不被最高档盖掉", () => {
    setupPicker({ value: "low" });
    expect(screen.getByRole("button", { name: /Low/ })).toBeTruthy();
  });

  it("点开：全部档位列出，只有当前档打勾", () => {
    setupPicker();
    fireEvent.click(screen.getByRole("button", { name: /High/ }));

    const radios = screen.getAllByRole("menuitemradio");
    expect(radios.map((r) => r.textContent)).toEqual(["Low", "High", "Max"]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
  });

  it("点一档：提交该档并关闭（选择即完成，没有第二个确认动作）", () => {
    const { pick } = setupPicker();
    fireEvent.click(screen.getByRole("button", { name: /High/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Max" }));

    expect(pick).toHaveBeenCalledTimes(1);
    expect(pick).toHaveBeenCalledWith("max");
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
  });

  it("⇧⌘E：循环到下一档（派发方是 useAppKeybinds / 命令面板）", () => {
    const { pick } = setupPicker();
    dispatchAppEvent(DD_EVENTS.cycleEffort);

    expect(pick).toHaveBeenCalledWith("max");
  });

  it("已在最后一档：循环回第一档", () => {
    const { pick } = setupPicker({ value: "max" });
    dispatchAppEvent(DD_EVENTS.cycleEffort);

    expect(pick).toHaveBeenCalledWith("low");
  });

  it("兜底显示最高档时，⇧⌘E 从那一档起绕（不是从最低档起）", () => {
    const { pick } = setupPicker({ value: undefined });
    dispatchAppEvent(DD_EVENTS.cycleEffort);

    expect(pick).toHaveBeenCalledWith("low");
  });

  it("无档位元数据：循环不提交（胶囊本就不渲染，这里钉住 hook 侧的空表守卫）", () => {
    const { pick } = setupPicker({ levels: [] });
    dispatchAppEvent(DD_EVENTS.cycleEffort);

    expect(pick).not.toHaveBeenCalled();
  });
});