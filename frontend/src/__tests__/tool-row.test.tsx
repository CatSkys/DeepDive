// 运行中的工具行（session/ToolRow）呈现契约（用户定稿）：状态由「正在执行」这行
// 文字自己脉冲承载，前导位不再摆闪烁的状态点——图标保持与落定行同款（用户参考图）。
// 脉冲本体在 theme.css（.tool-row[data-state="running"] .tool-title），所以这里钉住
// 触发它的那个属性与"没有状态点"两件事。
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToolRow } from "../session/ToolRow";

afterEach(cleanup);

describe("ToolRow 运行态", () => {
  it("运行中的行没有闪烁状态点，且带 data-state=running（脉冲挂在它上面）", () => {
    const { container } = render(
      <ToolRow toolName="bash" args={JSON.stringify({ command: "sleep 3" })} sessionId="s" />,
    );
    const row = container.querySelector(".tool-row");
    expect(row?.getAttribute("data-state")).toBe("running");
    expect(container.querySelector(".tool-leading .state-dot")).toBeNull();
    // 前导位仍是图标（与落定行同款）：bash 给终端图标
    expect(container.querySelector(".tool-leading svg")).toBeTruthy();
  });

  it("落定（有输出）的行同理不带状态点", () => {
    const { container } = render(
      <ToolRow toolName="bash" args={JSON.stringify({ command: "sleep 3" })} output="done" sessionId="s" />,
    );
    expect(container.querySelector(".tool-row")?.getAttribute("data-state")).toBe("done");
    expect(container.querySelector(".tool-leading .state-dot")).toBeNull();
  });
});
