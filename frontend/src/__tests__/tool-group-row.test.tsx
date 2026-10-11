// 工具组行（session/ToolGroupRow）呈现契约（用户定稿 2026-10-11）：与单条工具行
// 同一观感——icon·摘要，组名不摆；终端组图标与单条终端行同一个 glyph。
// 组在跑（末位成员未落结果）时 data-state=running，脉冲挂在摘要文字上（theme.css）。
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToolGroupRow } from "../session/ToolGroupRow";
import type { RenderItem } from "../session/renderModel";

afterEach(cleanup);

function bashItem(key: string, command: string, output?: string): RenderItem {
  return { key, kind: "tool-call", toolName: "bash", args: JSON.stringify({ command }), output };
}

describe("ToolGroupRow", () => {
  it("组行不摆组名，摘要是最新命令的摘要", () => {
    const { container } = render(
      <ToolGroupRow groupKind="execute" members={[bashItem("a", "make"), bashItem("b", "make clean", "done")]}>
        <div />
      </ToolGroupRow>,
    );
    expect(container.querySelector(".tool-group-label")).toBeNull();
    expect(container.querySelector(".tool-group-summary")?.textContent).toContain("make clean");
  });

  it("末位成员未落结果 → data-state=running；落定后无该属性", () => {
    const { container, rerender } = render(
      <ToolGroupRow groupKind="execute" members={[bashItem("a", "make", "ok"), bashItem("b", "make clean")]}>
        <div />
      </ToolGroupRow>,
    );
    expect(container.querySelector(".tool-group")?.getAttribute("data-state")).toBe("running");
    rerender(
      <ToolGroupRow groupKind="execute" members={[bashItem("a", "make", "ok"), bashItem("b", "make clean", "done")]}>
        <div />
      </ToolGroupRow>,
    );
    expect(container.querySelector(".tool-group")?.getAttribute("data-state")).toBeNull();
  });
});
