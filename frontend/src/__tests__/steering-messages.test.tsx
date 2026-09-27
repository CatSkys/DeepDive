// SteeringMessages 的回归面（frontend/src/session/SteeringMessages.tsx）：
// 立即发送/插话中的消息以流内用户气泡呈现、标「排队中」（用户定稿，对照 zcode），
// 不再进 QueueDock 的条；与流内已有用户消息同文的不重复画（真实消息先到的竞态）。
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SteeringMessages } from "../session/SteeringMessages";
import type { SessionQueuedItem } from "../types";

const queuedItem = (id: string, text: string): SessionQueuedItem => ({
  id,
  rpcId: `rpc-${id}`,
  placement: "steering",
  message: { content: [{ type: "text", text }] },
} as SessionQueuedItem);

afterEach(cleanup);

describe("SteeringMessages", () => {
  it("steering 项渲染为用户气泡并标排队中", () => {
    render(<SteeringMessages items={[queuedItem("a", "帮我跑下测试")]} sendingTexts={new Map()} flowUserTexts={new Set()} />);
    expect(screen.getByText("帮我跑下测试")).toBeTruthy();
    expect(screen.getByText("排队中")).toBeTruthy();
  });

  it("快照未观察到的本端消息（rpcId→文本）同样画气泡", () => {
    render(<SteeringMessages items={[]} sendingTexts={new Map([["rpc-1", "改一下标题"]])} flowUserTexts={new Set()} />);
    expect(screen.getByText("改一下标题")).toBeTruthy();
  });

  it("与流内已有用户消息同文的不画（真实消息已进流的竞态去重）", () => {
    render(
      <SteeringMessages
        items={[queuedItem("a", "帮我跑下测试")]}
        sendingTexts={new Map([["rpc-1", "帮我跑下测试"]])}
        flowUserTexts={new Set(["帮我跑下测试"])}
      />,
    );
    expect(screen.queryByText("排队中")).toBeNull();
  });

  it("没有待呈现项时什么都不渲染", () => {
    const { container } = render(<SteeringMessages items={[]} sendingTexts={new Map()} flowUserTexts={new Set()} />);
    expect(container.firstChild).toBeNull();
  });
});
