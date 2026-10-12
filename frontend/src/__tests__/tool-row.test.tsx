// 运行中的工具行（session/ToolRow）呈现契约（用户定稿）：状态由文字自己脉冲承载
// （行文案是 icon + 摘要，脉冲默认挂在摘要上，theme.css 的
// .tool-row[data-state="running"] :is(.tool-title, .tool-summary)），前导位不摆
// 闪烁的状态点——图标保持与落定行同款（用户参考图）。
// 行文案（用户定稿 2026-10-11）：工具名与分隔点不摆，摘要为空才落回名字/状态文案。
// 后台委派行（2026-10-12 定稿）：子会话在跑→data-tool-live 摘要继续脉冲，结束摘掉。
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "../types";

const storeMock = vi.hoisted(() => ({ sessions: [] as SessionSummary[] }));
vi.mock("../store", () => ({ useStore: () => ({ sessions: storeMock.sessions }) }));

import { ToolRow } from "../session/ToolRow";

afterEach(() => {
  cleanup();
  storeMock.sessions = [];
});

describe("ToolRow 运行态", () => {
  it("运行中的行没有闪烁状态点，且带 data-state=running（脉冲挂在它上面）", () => {
    const { container } = render(
      <ToolRow toolName="bash" args={JSON.stringify({ command: "sleep 3" })} sessionId="s" />,
    );
    const row = container.querySelector(".tool-row");
    expect(row?.getAttribute("data-state")).toBe("running");
    expect(container.querySelector(".tool-leading .state-dot")).toBeNull();
    // 前导位仍是图标（与落定行同款）：bash 给终端图标
    expect(container.querySelector(".tool-leading svg")).toBeTruthy();
    // 有摘要：工具名不摆，脉冲由摘要文字承载
    expect(container.querySelector(".tool-title")).toBeNull();
    expect(container.querySelector(".tool-summary")?.textContent).toBe("sleep 3");
  });

  it("运行中且没有摘要的行落回「正在执行」", () => {
    const { container } = render(<ToolRow toolName="list_files" args="" sessionId="s" />);
    expect(container.querySelector(".tool-title")?.textContent).toBe("正在执行");
    expect(container.querySelector(".tool-summary")).toBeNull();
  });

  it("落定（有输出）的行同理不带状态点", () => {
    const { container } = render(
      <ToolRow toolName="bash" args={JSON.stringify({ command: "sleep 3" })} output="done" sessionId="s" />,
    );
    expect(container.querySelector(".tool-row")?.getAttribute("data-state")).toBe("done");
    expect(container.querySelector(".tool-leading .state-dot")).toBeNull();
  });

  it("行文案（用户定稿 2026-10-11）：有摘要不摆工具名；摘要为空才落回名字", () => {
    const { container } = render(
      <ToolRow toolName="bash" args={JSON.stringify({ command: "sleep 3", description: "等三秒" })} output="ok" sessionId="s" />,
    );
    expect(container.querySelector(".tool-title")).toBeNull();
    expect(container.querySelector(".tool-summary")?.textContent).toBe("等三秒");

    const empty = render(<ToolRow toolName="list_files" args="" output="" sessionId="s" />);
    expect(empty.container.querySelector(".tool-title")?.textContent).toBe("列出");
    expect(empty.container.querySelector(".tool-summary")).toBeNull();
  });
});

describe("ToolRow 子智能体委派行（subagent）", () => {
  const args = JSON.stringify({
    description: "测试失败路径回报",
    prompt: "你是一个测试用子 Agent。本次任务专门测试\"失败路径如何回报\"。全部为只读/无副作用操作。",
  });

  it("摘要=description 短描述，整段提示词不上行（用户 2026-10-12 定稿）", () => {
    const { container } = render(<ToolRow toolName="subagent" args={args} sessionId="s" toolCallId="call-1" />);
    expect(container.querySelector(".tool-summary")?.textContent).toBe("测试失败路径回报");
    expect(container.querySelector(".tool-summary")?.textContent).not.toContain("测试用子 Agent。");
  });

  it("前导是 seed=身份串的渐变形状头像（与面板行同一身份）；无身份串回落工具调用 id 的头像", () => {
    const withId = render(<ToolRow toolName="subagent" args={args} sessionId="s" toolCallId="call-1" />);
    expect(withId.container.querySelector(".tool-leading .agent-orb")).toBeTruthy();
    cleanup();
    // args 缺 description：头像退到 callId seed 的另一颗（仍不落回机器人图标）
    const noIdentity = render(
      <ToolRow toolName="subagent" args={JSON.stringify({ prompt: "p" })} sessionId="s" toolCallId="call-2" />,
    );
    expect(noIdentity.container.querySelector(".tool-leading .agent-orb")).toBeTruthy();
  });
});

describe("ToolRow 后台委派行的运行态脉冲（data-tool-live）", () => {
  const args = JSON.stringify({ description: "调研", prompt: "p" });

  it("子会话在跑：result 已到、行是 done，但摘要继续脉冲（data-tool-live）", () => {
    storeMock.sessions = [{ sessionId: "child-9", updatedAt: 0, running: true, blank: false }];
    const { container } = render(
      <ToolRow toolName="subagent" args={args} output="started subagent child-9" sessionId="s" toolCallId="c" childSessionId="child-9" />,
    );
    const row = container.querySelector(".tool-row");
    expect(row?.getAttribute("data-state")).toBe("done");
    expect(row?.getAttribute("data-tool-live")).toBe("true");
  });

  it("子会话结束：data-tool-live 摘掉，落回静态 done 行（用户定稿：结束就不要）", () => {
    storeMock.sessions = [{ sessionId: "child-9", updatedAt: 0, running: false, blank: false }];
    const { container } = render(
      <ToolRow toolName="subagent" args={args} output="started subagent child-9" sessionId="s" toolCallId="c" childSessionId="child-9" />,
    );
    const row = container.querySelector(".tool-row");
    expect(row?.getAttribute("data-state")).toBe("done");
    expect(row?.getAttribute("data-tool-live")).toBeNull();
  });

  it("非委派行/无子会话 id 的行不吃这个属性；行自身在跑仍有 data-state=running 脉冲", () => {
    const { container } = render(
      <ToolRow toolName="subagent" args={args} sessionId="s" toolCallId="c" />,
    );
    expect(container.querySelector(".tool-row")?.getAttribute("data-tool-live")).toBeNull();
    expect(container.querySelector(".tool-row")?.getAttribute("data-state")).toBe("running");
  });
});
