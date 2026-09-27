// 产物/交付合并行（ArtifactsRow）钉子：单行单标签、按路径去重、容量截断、
// 交付描述降为 tooltip、图片出缩略图。
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactsRow, ToolRow } from "../session/ToolRow";

afterEach(cleanup);

describe("ArtifactsRow 产物/交付合并行", () => {
  it("交付与产物合成一个「产物」行，按路径去重", () => {
    const { container, getByTitle } = render(
      <ArtifactsRow
        produced={["frontend/src/a.ts", "frontend/src/b.ts"]}
        presented={[{ path: "frontend/src/a.ts", description: "同一文件不重复" }]}
        root="/w"
      />,
    );
    expect(container.querySelectorAll(".produced")).toHaveLength(1);
    expect(container.querySelector(".delivered")).toBeNull(); // 不再有两行
    const chips = [...container.querySelectorAll(".produced-file")];
    expect(chips).toHaveLength(2);
    expect(getByTitle("同一文件不重复").textContent).toBe("a.ts"); // 描述降为 tooltip
  });

  it("超过 6 个以 +n 收尾（照官方 ProducedFiles 的 SHOWN_LIMIT）；无文件整行不渲染", () => {
    const many = Array.from({ length: 11 }, (_, i) => `f${i}.ts`);
    const { container } = render(<ArtifactsRow produced={many} presented={[]} root="/w" />);
    expect(container.querySelectorAll(".produced-file")).toHaveLength(6);
    expect(container.querySelector(".produced-more")?.textContent).toBe("+ 5 个文件");

    const { container: empty } = render(<ArtifactsRow produced={[]} presented={[]} root="/w" />);
    expect(empty.querySelector(".produced")).toBeNull();
  });

  it("交付图片走缩略图 chip", () => {
    const { container } = render(
      <ArtifactsRow produced={[]} presented={[{ path: "shots/a.png", description: "跑分截图" }]} root="/w" />,
    );
    expect(container.querySelector("img.delivered-thumb")).not.toBeNull();
  });
});

// 工具行标题：MCP 工具不再摆整条 wire 名（用户定稿：mcp__<服务器>__<工具>
// → "<服务器> · <工具>"，图标走 mcp 族）。
describe("ToolRow 标题", () => {
  const row = (toolName: string) => render(
    <ToolRow toolName={toolName} args='{"code":"1+1"}' output="ok" sessionId="s" />,
  );
  it("MCP 工具：标题是「服务器 · 工具」，行带 mcp 数据标记", () => {
    const { container } = row("mcp__deepdive-browser__js");
    expect(container.querySelector(".tool-title")?.textContent).toBe("deepdive-browser · js");
    expect(container.querySelector(".tool-row")?.getAttribute("data-tool")).toBe("mcp__deepdive-browser__js");
  });
  it("未收录的普通工具仍显原名", () => {
    const { container } = row("weird_tool");
    expect(container.querySelector(".tool-title")?.textContent).toBe("weird_tool");
  });
});
