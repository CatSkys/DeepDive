// 模型菜单基准详情卡测试：withFacts join 命中（**按模型名匹配，键不带提供方**）/
// 未收录回退、成本刻度推导（引擎牌价优先、手抄档兜发不了价的）、收图标注（同一张模型
// 目录，手写路由声明模型条目时取它）、按厂商分组、ⓘ 开合、hover 换内容、搜索空组隐藏、
// 点卡片不算外点。
// portal 到 body 的节点不在 RTL 容器内——直接 document.querySelector
// （仿 context-menu.test.tsx 的 portal 路线）。
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelMenu, type ModelOption } from "../components/ModelMenu";
import { benchKey, costMeter, costScaleFromPrices, modelVision, withFacts } from "../modelFacts";

// jsdom 不实现 matchMedia（prefs.ts 初始化外观要用），补标准 stub
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// useT 依赖 store context。这里给一个最小的 store：`lang` 只为词典默认态（zh 恒等），
// `modelDetail` 是**本轮修的那条**——ⓘ 的开合态住在 store 那份偏好里（壳 UserDefaults
// 持久化），菜单每次打开都重挂，读组件自己 new 的 state 会永远从默认值起。
// 所以这份 mock 必须**跨挂载存活**（值放在 `storeMock.state` 上）且**写入会通知订阅方**
// （useSyncExternalStore + 一张订阅表），否则旧实现（每次挂载重建默认值）也能蒙过去。
const storeMock = vi.hoisted(() => {
  // 值**整体替换**而不是原地改字段：useSyncExternalStore 拿 `Object.is` 比 snapshot，
  // 原地改会让它认为"没变"、不重渲染（第一次写这条 mock 时就踩了）。
  let state = { lang: "zh", modelDetail: true };
  const subs = new Set<() => void>();
  return {
    /** 当前偏好（断言与播种用）。 */
    get state() { return state; },
    /** 模拟"壳里已经存着某个值"（挂载前播种，不通知）。 */
    seed: (modelDetail: boolean) => { state = { ...state, modelDetail }; },
    subscribe: (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; },
    snapshot: () => state,
    setModelDetail: (v: boolean) => { state = { ...state, modelDetail: v }; subs.forEach((f) => f()); },
  };
});
vi.mock("../store", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useStore: () => {
      const s = useSyncExternalStore(storeMock.subscribe, storeMock.snapshot);
      return { lang: s.lang, modelDetail: s.modelDetail, setModelDetail: storeMock.setModelDetail };
    },
  };
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = ""; // portal 残留清干净
  storeMock.seed(true); // 偏好默认开，逐条测试互不串
});

const opts: ModelOption[] = [
  {
    provider: "deepseek-official", model: "deepseek-v4-pro", label: "DeepSeek V4 Pro", providerLabel: "DeepSeek",
    efforts: [{ id: "high", name: "High" }], contextWindow: 1000000,
  },
  { provider: "deepseek-official", model: "deepseek-v4-nobench", label: "DeepSeek V4 Nobench", providerLabel: "DeepSeek" },
  {
    // 登记表里是原值（tps 70.2 / ii 53），折档在 withFacts：速度 2 / 智能 4；
    // 卡上成本跟引擎价（fixture 给 $5/$25 → 折 3 档）
    provider: "anthropic", model: "claude-fable-5-1", label: "Claude Fable 5.1", providerLabel: "Anthropic",
    inputModalities: ["text", "image"], contextWindow: 1000000,
    cost: { input: 5, output: 25 },
  },
  {
    // 半张卡回归（用户 2026-10-10）：只有成本、缺速度/智能 → 占位框，绝不出现单条成本刻度
    provider: "deepseek-official", model: "deepseek-partial", label: "DeepSeek Partial", providerLabel: "DeepSeek",
    cost: { input: 0.3, output: 1.2 },
    facts: { cost: 2 },
  },
];

/** 造一个只填 provider/model 的选项（跨路由同名匹配的用例都在用它）。 */
const opt = (provider: string, model: string): ModelOption => ({ provider, model, label: model, providerLabel: provider });

/** 持开合 state 的壳：外点关闭真的会卸菜单，断言"点卡片不关"才有效。 */
function Harness(props: { options: ModelOption[]; current: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button ref={ref} data-testid="trigger">模型</button>
      {open && (
        <ModelMenu options={withFacts(props.options)} current={props.current} onPick={() => {}} onClose={() => setOpen(false)} anchorRef={ref} />
      )}
    </div>
  );
}

describe("模型基准登记表 join", () => {
  it("原值折档：deepseek-v4-pro（84.7 tok/s · II 36 · $1.32/$3.96）→ 速度 2 / 智能 2 / 成本 2；未收录原样回退", () => {
    const out = withFacts(opts);
    expect(out[0].facts).toEqual({ speed: 2, intelligence: 2, cost: 2 });
    expect(out[1].facts).toBeUndefined();
    expect(out[2].facts).toEqual({ speed: 2, intelligence: 4, cost: 4 }); // 70.2 · 53 · $10/$50
  });
});

// 键规则（用户 2026-10-14 定稿）：一个模型一行，键是**模型名**本身——谁家端点都一样。
// 这张表此前按 `${provider}/${model}` 存，同一个模型在每条路由上各抄一份，新接的
// 提供商（CommandCode）因为键对不上，详情卡整片"暂无基准数据"。
describe("按模型名匹配（键不带提供方）", () => {
  it("benchKey：小写 + 只取最后一个 / 之后那段", () => {
    expect(benchKey("zai-org/GLM-5.2")).toBe("glm-5.2");
    expect(benchKey("MiniMaxAI/MiniMax-M3")).toBe("minimax-m3");
    expect(benchKey("deepseek/deepseek-v4.1-flash")).toBe("deepseek-v4.1-flash");
    expect(benchKey("gpt-6-astra")).toBe("gpt-6-astra");
  });

  it("同一模型走哪条路由都是同一份刻度（83.3 tok/s · II 34 → 速度 2 / 智能 1 / 成本 2）", () => {
    const [cc, zai, go] = withFacts([
      opt("commandcode", "zai-org/GLM-5.2"),
      opt("zai", "glm-5.2"),
      opt("opencode-go", "glm-5.2"),
    ]);
    expect(cc.facts).toEqual({ speed: 2, intelligence: 1, cost: 2 });
    expect(cc.facts).toEqual(zai.facts);
    expect(cc.facts).toEqual(go.facts);
  });

  it("厂商前缀照带：moonshotai/Kimi-K3、MiniMaxAI/MiniMax-M3 都命中那一行（大小写无关）", () => {
    const [kimi, minimax] = withFacts([
      opt("commandcode", "moonshotai/Kimi-K3"),
      opt("commandcode", "MiniMaxAI/MiniMax-M3"),
    ]);
    expect(kimi.facts).toEqual({ speed: 1, intelligence: 3, cost: 3 }); // 39.2 · 44 · $3/$15
    expect(minimax.facts).toEqual({ speed: 2, intelligence: 1, cost: 1 }); // 96.6 · 29 · $0.6/$2.4
  });

  it("表里没有的模型原样回退（带不带前缀都一样：ga 不上就不现编）", () => {
    const out = withFacts([opt("commandcode", "tencent/hy4-preview"), opt("commandcode", "tencent/hy4")]);
    expect(out[0].facts).toBeUndefined();
    expect(out[1].facts).toBeUndefined();
  });
});

// 收图同样是**模型**事实（用户 2026-10-14：提供方是无限的、模型是有限的——维护好模型，
// 后面模型匹配上就有相应配置）。手写路由的模型在引擎目录里没有条目、能力无处继承，
// 所以声明模型条目时从这里取判据。
describe("模型目录：收图标注", () => {
  it("按模型名匹配：带厂商前缀、带点、大小写都命中", () => {
    expect(modelVision("deepseek/deepseek-v4.1-flash")).toBe(true);
    expect(modelVision("moonshotai/Kimi-K3")).toBe(true);
    expect(modelVision("Qwen/Qwen3.8-Flash")).toBe(true);
  });

  it("厂商没标收图的一律不收（引擎的默认口径，不替厂商放大能力）", () => {
    for (const id of ["deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-flash", "zai-org/GLM-5.2", "zai-org/GLM-5", "MiniMaxAI/MiniMax-M2.7"]) {
      expect(modelVision(id)).toBe(false);
    }
  });

  it("目录外的陌生模型不收图（宁可本地早拒一张图，也别让已落库的请求中途失败）", () => {
    expect(modelVision("acme/brand-new-model")).toBe(false);
  });

  it("只有能力标注的行不挂刻度（不冒充「收录了基准」，卡片仍是占位、也不声明工具）", () => {
    const [o] = withFacts([opt("commandcode", "stepfun/Step-5-Preview")]);
    expect(modelVision("stepfun/Step-5-Preview")).toBe(true);
    expect(o.facts).toBeUndefined();
  });
});

describe("成本刻度推导", () => {
  it("costScaleFromPrices：0.3×输入 + 0.7×输出 → ≤1→0 / ≤3→1 / ≤10→2 / ≤25→3 / 否则 4（越满越贵）", () => {
    // deepseek-flash peak：0.3/1.2 → 0.93 → 0（便宜=短条）
    expect(costScaleFromPrices({ input: 0.3, output: 1.2, cacheRead: 0.006 })).toBe(0);
    // deepseek-v4-pro peak：1.32/3.96 → 3.17 → 2
    expect(costScaleFromPrices({ input: 1.32, output: 3.96, cacheRead: 0.044 })).toBe(2);
    expect(costScaleFromPrices({ input: 2, output: 3.2 })).toBe(1);
    // input 20/output 40 → 6+28=34 → 4（贵=满条）
    expect(costScaleFromPrices({ input: 20, output: 40 })).toBe(4);
    expect(costScaleFromPrices(undefined)).toBeUndefined();
  });

  it("costMeter：有引擎牌价一律跟引擎，引擎发不了价的模型才用手抄档兜底", () => {
    expect(costMeter({ cost: { input: 0.3, output: 1.2 }, facts: { cost: 3 } })).toBe(0); // 实况 0.93 → 0 档
    expect(costMeter({ cost: undefined, facts: { cost: 2 } })).toBe(2);
    expect(costMeter({ cost: { input: 20, output: 40 }, facts: undefined })).toBe(4);
    expect(costMeter({ cost: undefined, facts: undefined })).toBeUndefined();
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

  it("ⓘ 基准详情默认开（壳偏好持久化，用户 2026-10-11 定稿）：点击收起/再开；hover 换内容；未收录显示占位框", async () => {
    render(<Harness options={opts} current="Claude Fable 5.1" />);
    // 默认开：卡直接在，内容跟当前选择
    expect(document.querySelector(".model-detail")).not.toBeNull();
    expect(document.querySelector(".model-detail-name")!.textContent).toBe("Claude Fable 5.1");
    // 点击收起 → 再点重开
    fireEvent.click(document.querySelector(".model-menu-info")!);
    // 旁位卡也是浮层：关掉要等它的离场动画收尾才从 DOM 里摘
    await waitFor(() => expect(document.querySelector(".model-detail")).toBeNull());
    fireEvent.click(document.querySelector(".model-menu-info")!);
    expect(document.querySelector(".model-detail")).not.toBeNull();
    // ⓘ 的悬浮注释走全局 data-tip 规范（不是原生 title）
    expect(document.querySelector(".model-menu-info")!.getAttribute("data-tip")).toBe("基准详情");
    expect(document.querySelector(".model-menu-info")!.getAttribute("title")).toBeNull();
    const rows = [...document.querySelectorAll(".model-menu-row")];
    // hover 未收录模型 → 占位框，卡名跟到 hover 行
    //（React 的 onMouseEnter 是 mouseover 模拟出来的；HoverScrollText 会渲染
    // 双份文本做滚动动画——派发用 mouseOver，匹配用 includes）
    fireEvent.mouseOver(rows.find((r) => r.textContent?.includes("DeepSeek V4 Nobench"))!);
    expect(document.querySelector(".model-detail-name")!.textContent).toBe("DeepSeek V4 Nobench");
    expect(document.querySelector(".model-detail-nobench")).not.toBeNull();
    // 半张卡回归：只有成本（无速度/智能）→ 占位框，一条刻度都不画
    fireEvent.mouseOver(rows.find((r) => r.textContent?.includes("DeepSeek Partial"))!);
    expect(document.querySelector(".model-detail-nobench")).not.toBeNull();
    expect(document.querySelectorAll(".model-detail-meter").length).toBe(0);
    // hover 回收录模型 → 三条刻度（速度/智能/成本），无占位
    fireEvent.mouseOver(rows.find((r) => r.textContent?.includes("Claude Fable 5.1"))!);
    expect(document.querySelector(".model-detail-name")!.textContent).toBe("Claude Fable 5.1");
    expect(document.querySelector(".model-detail-nobench")).toBeNull();
    expect(document.querySelectorAll(".model-detail-meter").length).toBe(3);
    // 刻度条内缩（用户 2026-10-11 定稿）：0 档→10%、4 档→90%，永不空条/顶满
    const fills = [...document.querySelectorAll(".model-detail-meter .fill")].map((e) => (e as HTMLElement).style.width);
    expect(fills).toEqual(["50%", "90%", "70%"]); // 速度2 / 智能4 / 成本3（$5/$25 → 19）
  });

  it("ⓘ 开合态是偏好不是菜单的局部状态：偏好关着菜单开出来就是关的，点了写回偏好，重挂仍读它", async () => {
    storeMock.seed(false);
    const first = render(<Harness options={opts} current="Claude Fable 5.1" />);
    // 偏好关着 → 菜单开出来不带卡（旧实现读的是组件自己那份 state，永远从默认值"开"起，
    // 这就是用户报的"关了它每次开还出现"）
    expect(document.querySelector(".model-detail")).toBeNull();
    expect(document.querySelector(".model-menu-info")!.getAttribute("aria-pressed")).toBe("false");
    // 点开 → 写回偏好（壳据此落 UserDefaults）
    fireEvent.click(document.querySelector(".model-menu-info")!);
    expect(storeMock.state.modelDetail).toBe(true);
    expect(document.querySelector(".model-detail")).not.toBeNull();
    // 再关掉 → 偏好跟着回去；菜单整体重挂（= 关掉菜单再打开）仍读偏好，不回默认值
    fireEvent.click(document.querySelector(".model-menu-info")!);
    await waitFor(() => expect(document.querySelector(".model-detail")).toBeNull());
    expect(storeMock.state.modelDetail).toBe(false);
    first.unmount();
    render(<Harness options={opts} current="Claude Fable 5.1" />);
    expect(document.querySelector(".model-detail")).toBeNull();
  });

  it("搜索过滤：空组标题隐藏", () => {
    render(<Harness options={opts} current="Claude Fable 5.1" />);
    fireEvent.change(document.querySelector(".model-menu-search input")!, { target: { value: "Claude" } });
    const groups = [...document.querySelectorAll(".model-menu-group")].map((e) => e.textContent);
    expect(groups).toEqual(["Anthropic"]);
  });

  it("点卡片不关闭菜单，外点（body）才关", async () => {
    render(<Harness options={opts} current="Claude Fable 5.1" />);
    fireEvent.click(document.querySelector(".model-menu-info")!); // 默认开 → 先收起
    fireEvent.click(document.querySelector(".model-menu-info")!); // 再展开
    const card = document.querySelector(".model-detail")!;
    fireEvent.mouseDown(card);
    expect(document.querySelector(".model-menu")).not.toBeNull();
    await act(async () => {
      fireEvent.mouseDown(document.body);
      await Promise.resolve();
    });
    await waitFor(() => expect(document.querySelector(".model-menu")).toBeNull());
  });
});
