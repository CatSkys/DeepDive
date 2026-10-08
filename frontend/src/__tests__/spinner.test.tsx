// 行内转圈（R-001 网眼）：形状契约。弧长由 Spinner 按圆周算成**绝对用户单位**的
// stroke-dasharray（不走 SVG 的 pathLength 归一），所以 r 与弧长是一对：这里核对
// 短/长两端的弧长确实落在周长的 10%–70%，改 r 忘改弧长就会红。
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Spinner } from "../components/LoadingState";

afterEach(cleanup);

describe("Spinner", () => {
  it("淡轨道 + 会伸缩的弧：半径留出线宽、伸缩两头按周长算", () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector("svg.spin-ring")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 12 12");

    const track = svg.querySelector("circle.spin-ring-track")!;
    const arc = svg.querySelector("circle.spin-ring-arc")!;
    const r = Number(track.getAttribute("r"));
    expect(r).toBe(5.3); // r + 线宽 1.4 的一半 = 6.0，正好贴满 12 的框
    expect(arc.getAttribute("r")).toBe("5.3");
    expect(track.getAttribute("stroke-dasharray")).toBeNull(); // 轨道是整圈

    const circumference = 2 * Math.PI * r;
    const [dash, gap] = arc.getAttribute("stroke-dasharray")!.split(" ").map(Number);
    expect(dash).toBeCloseTo(circumference * 0.1, 1);
    expect(gap).toBeCloseTo(circumference, 1);

    // 伸缩：SMIL 的 values 首尾都回到短弧（无缝循环），中点是长弧
    const animate = arc.querySelector("animate")!;
    expect(animate.getAttribute("attributeName")).toBe("stroke-dasharray");
    const values = animate.getAttribute("values")!.split(";").map((v) => Number(v.split(" ")[0]));
    expect(values).toHaveLength(3);
    expect(values[0]).toBeCloseTo(values[2], 2);
    expect(values[1]).toBeCloseTo(circumference * 0.7, 1);
  });

  it("装饰性用 aria-hidden；给了 label 才进无障碍树（浏览器标签那枚）", () => {
    const bare = render(<Spinner />).container.querySelector("svg")!;
    expect(bare.getAttribute("aria-hidden")).toBe("true");
    expect(bare.getAttribute("role")).toBeNull();

    const named = render(<Spinner className="panel-browser-tab-ring" label="加载中" />).container.querySelector("svg")!;
    expect(named.getAttribute("class")).toBe("spin-ring panel-browser-tab-ring");
    expect(named.getAttribute("role")).toBe("img");
    expect(named.getAttribute("aria-label")).toBe("加载中");
    expect(named.getAttribute("aria-hidden")).toBeNull();
  });
});
