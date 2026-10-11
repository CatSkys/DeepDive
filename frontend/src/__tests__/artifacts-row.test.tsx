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

// 工具行文案（用户定稿 2026-10-11：一律 icon·摘要，工具名不摆——MCP 工具也不摆
// 整条 wire 名）；摘要为空才落回名字，对外名规则在 toolKind.toolDisplayName：
// mcp__<服务器>__<工具> → "<服务器> · <工具>"，图标走 mcp 族。
describe("ToolRow 文案", () => {
  it("有摘要的行不摆名字（MCP 工具同理），行带 data-tool 标记", () => {
    const { container } = render(
      <ToolRow toolName="mcp__linear__create_issue" args='{"code":"1+1"}' output="ok" sessionId="s" />,
    );
    expect(container.querySelector(".tool-title")).toBeNull();
    expect(container.querySelector(".tool-summary")?.textContent).toBe("1+1");
    expect(container.querySelector(".tool-row")?.getAttribute("data-tool")).toBe("mcp__linear__create_issue");
  });
  it("摘要为空落回对外名：其他服务器是「服务器 · 工具」，浏览器控制是产品名，未收录显原名", () => {
    const named = (toolName: string) =>
      render(<ToolRow toolName={toolName} args="" output="" sessionId="s" />).container.querySelector(".tool-title")?.textContent;
    expect(named("mcp__linear__create_issue")).toBe("linear · create_issue");
    expect(named("mcp__deepdive-browser__js")).toBe("浏览器控制");
    expect(named("weird_tool")).toBe("weird_tool");
  });
});
