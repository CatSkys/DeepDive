// 产物/交付合并行（ArtifactsRow）钉子：单行单标签、按路径去重、容量截断、
// 交付描述降为 tooltip、图片出缩略图。
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactsRow } from "../session/ToolRow";

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

  it("超过 8 个以 +n 收尾；无文件整行不渲染", () => {
    const many = Array.from({ length: 11 }, (_, i) => `f${i}.ts`);
    const { container } = render(<ArtifactsRow produced={many} presented={[]} root="/w" />);
    expect(container.querySelectorAll(".produced-file")).toHaveLength(8);
    expect(container.querySelector(".produced-more")?.textContent).toBe("+ 3 个文件");

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
