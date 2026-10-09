// 页内查找胶囊：⌘F 打开 → 打字上色 → Enter/⇧Enter 走命中 → Esc 撤干净。
// jsdom 没有 CSS Custom Highlight API，这里按契约摆一个替身（真机上由 WebKit 提供，
// 「有没有」的探测就是 openFindInConversation 的第一句）。
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../store", () => ({ useStore: () => ({ lang: "zh" }) }));

import { FindInConversation, openFindInConversation } from "../components/FindInConversation";

type FakeHighlight = { ranges: Range[] };
const highlights = new Map<string, FakeHighlight>();
const activeRanges = () => highlights.get("find-active")?.ranges ?? [];
const allHits = () => highlights.get("find-hit")?.ranges ?? [];

beforeEach(() => {
  highlights.clear();
  vi.stubGlobal("CSS", { highlights: { set: (k: string, h: FakeHighlight) => highlights.set(k, h), delete: (k: string) => highlights.delete(k) } });
  vi.stubGlobal("Highlight", class { ranges: Range[]; constructor(...r: Range[]) { this.ranges = r; } });
  // jsdom 没有滚动：命令式滚动到当前命中那一步按空实现过
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();          // 不 cleanup 的话 document.querySelector 会命中上一轮留下的胶囊
  vi.unstubAllGlobals();
});

function Host() {
  const ref = createRef<HTMLDivElement>();
  return (
    <div>
      <div ref={ref}>海风穿过机房，海风很轻</div>
      <FindInConversation rootRef={ref} />
    </div>
  );
}

/** ⌘F 是从组件外部调的（模块级 opener），要 act 包一下才会 flush 出这一帧。 */
const pressFind = () => act(() => openFindInConversation());

describe("FindInConversation", () => {
  it("⌘F 打开：胶囊出现、输入框抢焦点", () => {
    const { container, queryByRole } = render(<Host />);
    expect(container.querySelector(".find-capsule")).toBeNull();
    pressFind();
    const input = queryByRole("textbox", { name: "页内查找" }) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);
  });

  it("打字即上色：全部命中一处、当前命中一处（两档高亮）", () => {
    const { container } = render(<Host />);
    pressFind();
    const input = container.querySelector(".find-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "海风" } });
    expect(allHits().map((r) => r.toString())).toEqual(["海风", "海风"]);
    expect(activeRanges().map((r) => r.toString())).toEqual(["海风"]);
  });

  it("Enter 走下一个、⇧Enter 回上一个，环形绕回来", () => {
    const { container } = render(<Host />);
    pressFind();
    const input = container.querySelector(".find-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "海风" } });
    const first = activeRanges()[0].startOffset;
    fireEvent.keyDown(input, { key: "Enter" });
    const second = activeRanges()[0].startOffset;
    expect(second).not.toBe(first);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(activeRanges()[0].startOffset).toBe(first); // 两处命中，转一圈回来
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(activeRanges()[0].startOffset).toBe(second);
  });

  it("找不到就不装作找到：提示没有匹配，两档高亮都撤掉", () => {
    const { container, getByText } = render(<Host />);
    pressFind();
    const input = container.querySelector(".find-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "不存在的词" } });
    expect(getByText("没有匹配")).toBeTruthy();
    expect(highlights.has("find-hit")).toBe(false);
    expect(highlights.has("find-active")).toBe(false);
  });

  it("Esc 关闭：胶囊收掉、两档高亮撤干净（不留痕迹在流上）", () => {
    const { container } = render(<Host />);
    pressFind();
    const input = container.querySelector(".find-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "海风" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(container.querySelector(".find-capsule")).toBeNull();
    expect(highlights.size).toBe(0);
  });

  it("引擎没有 Highlight API 就不开：不给一个按下去没反应的入口", () => {
    vi.stubGlobal("CSS", {});
    const { container } = render(<Host />);
    pressFind();
    expect(container.querySelector(".find-capsule")).toBeNull();
  });
});
