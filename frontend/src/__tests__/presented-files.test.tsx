// 交付文件卡组件行为（官方 ui-deliverables 语义移植）：图片出缩略图、其余出名称
// chip、空列表不渲染。断言用户可见结果（DOM 结构与 src），不断言类名细节。
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PresentedFiles } from "../session/PresentedFiles";

afterEach(cleanup);

describe("PresentedFiles 交付文件卡", () => {
  it("图片以内联缩略图呈现，src 走引擎受控读文件面（相对路径按 root 解析）", () => {
    const { container } = render(<PresentedFiles files={[{ path: "shots/a.png", description: "跑分" }]} root="/w/session" />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/api/file?path=%2Fw%2Fsession%2Fshots%2Fa.png");
    expect(img?.getAttribute("alt")).toBe("跑分");
    // 图片卡不留可点进默认应用的锚（点击 = 应用内预览）
    expect(container.querySelector("button")?.getAttribute("data-file-ctx")).toBe("/w/session/shots/a.png");
  });

  it("非图片出名称 chip，描述挂在 title 上", () => {
    const { container } = render(<PresentedFiles files={[{ path: "/tmp/report.md", description: "验收报告" }]} root="/w" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("report.md");
    expect(container.querySelector("button")?.getAttribute("title")).toBe("验收报告");
  });

  it("绝对路径不被 root 拼接；空列表不渲染", () => {
    const { container: c1 } = render(<PresentedFiles files={[{ path: "/abs/x.png" }]} root="/w" />);
    expect(c1.querySelector("button")?.getAttribute("data-file-ctx")).toBe("/abs/x.png");
    const { container: c2 } = render(<PresentedFiles files={[]} root="/w" />);
    expect(c2.innerHTML).toBe("");
  });
});
