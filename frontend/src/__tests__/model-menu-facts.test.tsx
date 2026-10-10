// 模型菜单基准详情卡测试：withFacts join 命中/未收录回退、按厂商分组、
// ⓘ 开合、hover 换内容、搜索空组隐藏、点卡片不算外点。
// portal 到 body 的节点不在 RTL 容器内——直接 document.querySelector
// （仿 context-menu.test.tsx 的 portal 路线）。
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelMenu, type ModelOption } from "../components/ModelMenu";
import { withFacts } from "../modelFacts";

// useT 依赖 store context：本测试只关心词典默认态（zh 恒等），给个最小壳。
vi.mock("../store", () => ({ useStore: () => ({ lang: "zh" }) }));

afterEach(() => {
  cleanup();
  document.body.innerHTML = ""; // portal 残留清干净
});

const opts: ModelOption[] = [
  {
    provider: "deepseek", model: "deepseek-v4-pro", label: "DeepSeek V4 Pro", providerLabel: "DeepSeek",
    efforts: [{ id: "high", name: "High" }], contextWindow: 1000000,
  },
  { provider: "deepseek", model: "deepseek-v4-nobench", label: "DeepSeek V4 Nobench", providerLabel: "DeepSeek" },
  {
    provider: "anthropic", model: "claude-fable-5-1", label: "Claude Fable 5.1", providerLabel: "Anthropic",
    inputModalities: ["text", "image"], contextWindow: 1000000,
    facts: { speed: 2, intelligence: 4, cost: 0 },
  },
];

/** 持开合 state 的壳：外点关闭真的会卸菜单，断言"点卡片不关"才有效。 */
function Harness(props: { options: ModelOption[]; current: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button ref={ref} data-testid="trigger">模型</button>
      {open && (
        <ModelMenu options={props.options} current={props.current} onPick={() => {}} onClose={() => setOpen(false)} anchorRef={ref} />
      )}
    </div>
  );
}

describe("模型基准登记表 join", () => {
  it("命中登记表附加刻度，未收录原样回退", () => {
    const out = withFacts(opts);
    expect(out[0].facts).toEqual({ speed: 2, intelligence: 1, cost: 4 });
    expect(out[1].facts).toBeUndefined();
    expect(out[2].facts).toBeDefined();
  });
});

describe("模型菜单基准详情卡", () => {
  it("菜单 portal 至 body，按厂商分组、行内不再有厂商名", () => {
    render(<Harness options={opts} current="Claude Fable 5.1" />);
    expect(document.querySelector(".model-menu")).not.toBeNull();
    const groups = [...document.querySelectorAll(".model-menu-group")].map((e) => e.textContent);
    expect(groups).toEqual(["DeepSeek", "Anthropic"]);
    expect(document.querySelector(".model-menu-row .provider")).toBeNull();
  });

  it("ⓘ 开卡：默认显示当前选择；hover 换内容；未收录显示占位框", () => {
    render(<Harness options={opts} current="Claude Fable 5.1" />);
    expect(document.querySelector(".model-detail")).toBeNull();
    fireEvent.click(document.querySelector(".model-menu-info")!);
    expect(document.querySelector(".model-detail")).not.toBeNull();
    expect(document.querySelector(".model-detail-name")!.textContent).toBe("Claude Fable 5.1");
    const rows = [...document.querySelectorAll(".model-menu-row")];
    // hover 未收录模型 → 占位框，卡名跟到 hover 行
    //（React 的 onMouseEnter 是 mouseover 模拟出来的；HoverScrollText 会渲染
    // 双份文本做滚动动画——派发用 mouseOver，匹配用 includes）
    fireEvent.mouseOver(rows.find((r) => r.textContent?.includes("DeepSeek V4 Nobench"))!);
    expect(document.querySelector(".model-detail-name")!.textContent).toBe("DeepSeek V4 Nobench");
    expect(document.querySelector(".model-detail-nobench")).not.toBeNull();
    // hover 回收录模型 → 三条刻度（速度/智能/成本），无占位
    fireEvent.mouseOver(rows.find((r) => r.textContent?.includes("Claude Fable 5.1"))!);
    expect(document.querySelector(".model-detail-name")!.textContent).toBe("Claude Fable 5.1");
    expect(document.querySelector(".model-detail-nobench")).toBeNull();
    expect(document.querySelectorAll(".model-detail-meter").length).toBe(3);
  });

  it("搜索过滤：空组标题隐藏", () => {
    render(<Harness options={opts} current="Claude Fable 5.1" />);
    fireEvent.change(document.querySelector(".model-menu-search input")!, { target: { value: "Claude" } });
    const groups = [...document.querySelectorAll(".model-menu-group")].map((e) => e.textContent);
    expect(groups).toEqual(["Anthropic"]);
  });

  it("点卡片不关闭菜单，外点（body）才关", async () => {
    render(<Harness options={opts} current="Claude Fable 5.1" />);
    fireEvent.click(document.querySelector(".model-menu-info")!);
    const card = document.querySelector(".model-detail")!;
    fireEvent.mouseDown(card);
    expect(document.querySelector(".model-menu")).not.toBeNull();
    await act(async () => {
      fireEvent.mouseDown(document.body);
      await Promise.resolve();
    });
    expect(document.querySelector(".model-menu")).toBeNull();
  });
});
