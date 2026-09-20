// 模型菜单第二层（思考强度）的渲染网眼：档位是**单选列表**（选中行带对勾）、
// 点选即提交并关菜单。滑杆改菜单是用户拍板的交互简化（拖拽手势多一层状态），
// 这几条钉住它别退回手势形态。@vitest-environment jsdom
import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelMenu, type ModelOption } from "../components/ModelMenu";

vi.mock("../store", () => ({ useStore: () => ({ lang: "zh" }) }));

afterEach(cleanup);

const FLASH: ModelOption = {
  provider: "deepseek",
  model: "v41-flash",
  label: "DeepSeek-V41-Flash",
  providerLabel: "DeepSeek",
  efforts: [{ id: "low", name: "Low" }, { id: "high", name: "High" }, { id: "max", name: "Max" }],
  defaultEffort: "high",
};

const PLAIN: ModelOption = { provider: "openai", model: "gpt", label: "GPT-4o", providerLabel: "OpenAI" };

function setup(over: Partial<ComponentProps<typeof ModelMenu>> = {}) {
  const onPick = vi.fn();
  const onApplyEffort = vi.fn();
  const onClose = vi.fn();
  render(
    <ModelMenu
      options={[FLASH, PLAIN]}
      current="GPT-4o"
      currentModel={{ provider: "openai", model: "gpt" }}
      effortValue={undefined}
      onPick={onPick}
      onApplyEffort={onApplyEffort}
      onClose={onClose}
      {...over}
    />,
  );
  return { onPick, onApplyEffort, onClose };
}

/** 进档位页的入口：点第一层里那个带档位的模型行。 */
function openEffortPage() {
  fireEvent.click(screen.getByText("DeepSeek-V41-Flash"));
}

describe("模型菜单 · 思考强度档位", () => {
  it("点带档位的模型：进档位页，三档都是单选项且只有默认档被勾上", () => {
    const { onPick } = setup();
    openEffortPage();

    expect(onPick).toHaveBeenCalledWith(FLASH);
    const radios = screen.getAllByRole("menuitemradio");
    expect(radios.map((r) => r.textContent)).toEqual(["Low", "High", "Max"]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
  });

  it("点一个档位：提交该档并关菜单（选择即完成，没有第二个确认动作）", () => {
    const { onApplyEffort, onClose } = setup();
    openEffortPage();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Max" }));

    expect(onApplyEffort).toHaveBeenCalledTimes(1);
    expect(onApplyEffort).toHaveBeenCalledWith(FLASH, "max");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("会话已生效档位优先于模型默认档：勾在生效的那一档上", () => {
    setup({ current: "DeepSeek-V41-Flash", currentModel: { provider: "deepseek", model: "v41-flash" }, effortValue: "low" });
    openEffortPage();

    const radios = screen.getAllByRole("menuitemradio");
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
  });

  it("无档位模型：点选即关，不进第二层", () => {
    const { onPick, onApplyEffort, onClose } = setup();
    fireEvent.click(screen.getByText("GPT-4o"));

    expect(onPick).toHaveBeenCalledWith(PLAIN);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApplyEffort).not.toHaveBeenCalled();
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
  });
});
