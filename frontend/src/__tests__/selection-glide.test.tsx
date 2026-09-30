// 选中态滑移底片（useSelectionGlide）：钉住 2026-09-30 用户报的那个现象——
// "切换会话后选中态失效、没有滑动"。根因是钩子只认选择器**字符串**，而换选中项时
// 那串字符串没变（[data-sel] 只是从一行搬到另一行），于是底片停在旧行上。
//
// jsdom 没有布局（offset* 全是 0），所以这里给每行按坐标打桩：断言的是
// "换选中项后底片重新量过"，不是具体像素。
// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { useSelectionGlide } from "../components/useSelectionGlide";

beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  }
});

afterEach(cleanup);

/** 给元素打上布局桩：offsetTop/Left/Width/Height 是 jsdom 里唯一缺的量。 */
function stubLayout(el: HTMLElement, top: number) {
  Object.defineProperty(el, "offsetTop", { value: top, configurable: true });
  Object.defineProperty(el, "offsetLeft", { value: 8, configurable: true });
  Object.defineProperty(el, "offsetWidth", { value: 224, configurable: true });
  Object.defineProperty(el, "offsetHeight", { value: 32, configurable: true });
}

function Harness() {
  const [active, setActive] = useState("s1");
  // 身份（active）必须作为依赖传进去——这正是被测的行为
  const glide = useSelectionGlide<HTMLDivElement>(active ? ".row[data-sel]" : null, active);
  return (
    <div>
      <button onClick={() => setActive("s2")}>切到 s2</button>
      <div className="list" ref={glide.setContainer}>
        {glide.box && <div className="sel-glide" data-testid="pill" style={glide.glideStyle} />}
        {["s1", "s2", "s3"].map((id, i) => (
          <div key={id} className="row" {...(id === active ? { "data-sel": "" } : {})} ref={(el) => { if (el) stubLayout(el, i * 32); }}>
            {id}
          </div>
        ))}
      </div>
    </div>
  );
}

describe("useSelectionGlide", () => {
  it("换选中项后底片跟到新行", () => {
    const { getByTestId, getByText } = render(<Harness />);
    const pill = () => getByTestId("pill");
    expect(pill().style.top).toBe("0px");      // 初始落在 s1
    fireEvent.click(getByText("切到 s2"));
    expect(pill().style.top).toBe("32px");     // 跟到 s2 —— 修好前这里仍是 0
  });

  it("无选中时不画底片", () => {
    function Empty() {
      const glide = useSelectionGlide<HTMLDivElement>(null, null);
      return <div ref={glide.setContainer}>{glide.box && <div data-testid="pill" />}</div>;
    }
    const { queryByTestId } = render(<Empty />);
    expect(queryByTestId("pill")).toBeNull();
  });

  it("选中项被移出列表时收起底片", () => {
    function Shrink() {
      const [list, setList] = useState(["s1", "s2"]);
      const glide = useSelectionGlide<HTMLDivElement>(list.length ? ".row[data-sel]" : null, list[0] ?? null);
      return (
        <div>
          <button onClick={() => setList([])}>清空</button>
          <div className="list" ref={glide.setContainer}>
            {glide.box && <div data-testid="pill" />}
            {list.map((id, i) => (
              <div key={id} className="row" {...(i === 0 ? { "data-sel": "" } : {})} ref={(el) => { if (el) stubLayout(el, 0); }} />
            ))}
          </div>
        </div>
      );
    }
    const { queryByTestId, getByText } = render(<Shrink />);
    expect(queryByTestId("pill")).not.toBeNull();
    fireEvent.click(getByText("清空"));
    expect(queryByTestId("pill")).toBeNull();
  });
});
