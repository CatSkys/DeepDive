// 会话里创建自动化的协议：围栏块解析（形状边界校验）+ 消息流渲染成建议卡、
// 点按钮派发预填事件；不按格式写的块退回普通代码块。
// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// 建议卡只用到语言的词典，不碰 store 数据
vi.mock("../store", () => ({
  useStore: () => ({ lang: "zh" }),
}));

import { Markdown } from "../components/Markdown";
import { parseProposal } from "../automation/protocol";

afterEach(cleanup);

const daily = {
  title: "每天重构扫除",
  instruction: "读取 scripts/refactor-sweep-prompt.md 做一轮扫除。只读分析。",
  schedule: { kind: "daily", hour: 9, minute: 0 },
};

const fenced = (body: string) => "```automation\n" + body + "\n```";

describe("parseProposal", () => {
  it("接受协议形状并归一可选字段", () => {
    expect(parseProposal(JSON.stringify(daily))).toEqual({ ...daily, workspace: null, permission: null });
    expect(parseProposal(JSON.stringify({ ...daily, workspace: "DeepDive", permission: "workspace-write" })))
      .toEqual({ ...daily, workspace: "DeepDive", permission: "workspace-write" });
  });

  it("坏 JSON / 缺字段 / 计划形状不对一律 null", () => {
    expect(parseProposal("{ not json")).toBeNull();
    expect(parseProposal(JSON.stringify({ ...daily, title: "  " }))).toBeNull();
    expect(parseProposal(JSON.stringify({ ...daily, instruction: 42 }))).toBeNull();
    expect(parseProposal(JSON.stringify({ ...daily, schedule: { kind: "cron", expr: "* * * * *" } }))).toBeNull();
    expect(parseProposal(JSON.stringify({ ...daily, schedule: { kind: "daily", hour: 9 } }))).toBeNull();
  });
});

describe("消息流里的定时任务建议卡", () => {
  it("按协议输出的围栏块渲染成卡：标题 / 计划 / 指令 + 创建按钮（在卡头右上）", () => {
    const { container } = render(<Markdown text={fenced(JSON.stringify(daily))} />);
    const card = container.querySelector(".auto-proposal");
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("定时任务建议");
    expect(card!.textContent).toContain("每天重构扫除");
    expect(card!.textContent).toContain("每天, 09:00");
    expect(card!.textContent).toContain("只读分析");
    // 创建入口在卡头行内（用户定稿：右上角），不在正文末尾另起一行
    expect(card!.querySelector(".head button")).not.toBeNull();
    expect(card!.querySelector(".actions")).toBeNull();
  });

  it("点「创建定时任务」派发预填事件（detail = 解析出的建议）", () => {
    const seen: unknown[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("dd:automation-draft", on);
    const { container } = render(<Markdown text={fenced(JSON.stringify(daily))} />);
    fireEvent.click(container.querySelector(".auto-proposal .head button")!);
    window.removeEventListener("dd:automation-draft", on);
    expect(seen).toEqual([{ ...daily, workspace: null, permission: null }]);
  });

  it("不按格式写的块仍是普通代码块（不冒充建议）", () => {
    const { container } = render(<Markdown text={fenced("随便一段不是 JSON 的文本")} />);
    expect(container.querySelector(".auto-proposal")).toBeNull();
    expect(container.querySelector(".cb")).not.toBeNull();
  });
});
