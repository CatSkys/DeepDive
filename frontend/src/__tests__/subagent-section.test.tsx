// 状态面板「子智能体」区（用户 2026-10-08 定稿）：行是两行（标签 + 子会话标题）、
// 右侧「状态 · 时长」，且**已结束默认展开**——折起来等于白列。
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const sessions = [
  {
    sessionId: "child-1",
    updatedAt: 1,
    running: false,
    blank: false,
    origin: "subagent",
    projections: {
      asOfSeq: 1,
      values: { title: "Audit docs and roadmap consistency", subagentTiming: { settledMs: 3_600_000 } },
    },
  },
  // 没有 subagentTiming 投影：时长那一截不显示，不许编数字
  { sessionId: "child-2", updatedAt: 1, running: false, blank: false, origin: "subagent" },
];
vi.mock("../store", () => ({ useStore: () => ({ sessions, lang: "zh" }) }));

import { CapsuleSubagentSection } from "../components/CapsuleSubagentSection";

const child = (id: string, label: string) =>
  ({ kind: "child" as const, id, activity: "inactive" as const, hasChildren: false, mode: "one-shot" as const, label });

const mount = (children = [child("child-1", "Find frontend and docs")]) =>
  render(
    <CapsuleSubagentSection
      children={children}
      runningIds={new Set<string>()}
      diag={false}
      busy={false}
      onOpen={() => {}}
      onInterrupt={() => {}}
    />,
  );

afterEach(cleanup);

describe("CapsuleSubagentSection", () => {
  it("已结束的行默认展开，不点折叠头也看得见", () => {
    const { getByText } = mount();
    expect(getByText("Find frontend and docs")).toBeTruthy();
  });

  it("副行只在子会话有自己的标题时给（没有投影标题就不出，回退文案不算标题）", () => {
    expect(mount().getByText("Audit docs and roadmap consistency")).toBeTruthy();
    cleanup();
    // child-2 没有 title 投影：不能把「任务 child-」这种回退文案当标题摆出来
    const bare = mount([child("child-2", "Something else")]);
    expect(bare.getByText("Something else")).toBeTruthy();
    expect(bare.container.querySelectorAll(".capsule-sub-line")).toHaveLength(0);
  });

  it("已结束的行前导用对勾（在跑是 seed 定的渐变球）", () => {
    expect(mount().container.querySelector(".lucide-circle-check")).toBeTruthy();
    cleanup();
    const live = render(
      <CapsuleSubagentSection
        children={[child("child-1", "Find frontend and docs")]}
        runningIds={new Set(["child-1"])}
        diag={false}
        busy={false}
        onOpen={() => {}}
        onInterrupt={() => {}}
      />,
    );
    expect(live.container.querySelector(".lucide-circle-check")).toBeNull();
    expect(live.container.querySelector(".agent-orb")).toBeTruthy();
  });

  it("右侧是「已结束 · 时长」，取投影 subagentTiming.settledMs；投影缺字段只给状态", () => {
    expect(mount().getByText("已结束 · 1 小时")).toBeTruthy();
    cleanup();
    expect(mount([child("child-2", "Something else")]).getByText("已结束")).toBeTruthy();
  });
});
