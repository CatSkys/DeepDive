// 运行中的工具行（session/ToolRow）呈现契约（用户定稿）：状态由文字自己脉冲承载
// （行文案是 icon + 摘要，脉冲默认挂在摘要上，theme.css 的
// .tool-row[data-state="running"] :is(.tool-title, .tool-summary)），前导位不摆
// 闪烁的状态点——图标保持与落定行同款（用户参考图）。
// 行文案（用户定稿 2026-10-11）：工具名与分隔点不摆，摘要为空才落回名字/状态文案。
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
    // 有摘要：工具名不摆，脉冲由摘要文字承载
    expect(container.querySelector(".tool-title")).toBeNull();
    expect(container.querySelector(".tool-summary")?.textContent).toBe("sleep 3");
  });

  it("运行中且没有摘要的行落回「正在执行」", () => {
    const { container } = render(<ToolRow toolName="list_files" args="" sessionId="s" />);
    expect(container.querySelector(".tool-title")?.textContent).toBe("正在执行");
    expect(container.querySelector(".tool-summary")).toBeNull();
  });

  it("落定（有输出）的行同理不带状态点", () => {
    const { container } = render(
      <ToolRow toolName="bash" args={JSON.stringify({ command: "sleep 3" })} output="done" sessionId="s" />,
    );
    expect(container.querySelector(".tool-row")?.getAttribute("data-state")).toBe("done");
    expect(container.querySelector(".tool-leading .state-dot")).toBeNull();
  });

  it("行文案（用户定稿 2026-10-11）：有摘要不摆工具名；摘要为空才落回名字", () => {
    const { container } = render(
      <ToolRow toolName="bash" args={JSON.stringify({ command: "sleep 3", description: "等三秒" })} output="ok" sessionId="s" />,
    );
    expect(container.querySelector(".tool-title")).toBeNull();
    expect(container.querySelector(".tool-summary")?.textContent).toBe("等三秒");

    const empty = render(<ToolRow toolName="list_files" args="" output="" sessionId="s" />);
    expect(empty.container.querySelector(".tool-title")?.textContent).toBe("列出文件");
    expect(empty.container.querySelector(".tool-summary")).toBeNull();
  });
});
