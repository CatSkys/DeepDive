// 插话队列（session/SteerQueue）的契约（用户 2026-10-10 定稿）：插话中的消息用
// 消息形态排队——用户气泡 + 状态行「等待引导当前任务…」；操作钮给编辑/删除
// （「立即」不给——它已经在引导当前轮）；带附件的行不给编辑钮（引擎的排队
// 编辑只收文本）。
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SteerQueue } from "../session/SteerQueue";
import type { SessionQueuedItem } from "../types";

const updateQueue = vi.fn().mockResolvedValue({});
vi.mock("../api", () => ({
  api: {
    updateQueue: (...args: unknown[]) => updateQueue(...args),
    attachment: vi.fn().mockResolvedValue({ attachment: { mediaType: "image/png" }, data: "" }),
  },
}));

const item = (id: string, text: string): SessionQueuedItem => ({
  id,
  rpcId: `rpc-${id}`,
  placement: "steering",
  message: { id, content: [{ type: "text", text }] },
});

afterEach(cleanup);

describe("SteerQueue", () => {
  it("消息形态：气泡文本 + 状态行「等待引导当前任务…」，编辑/删除钮在，没有「立即」", () => {
    render(<SteerQueue sessionId="s" items={[item("a", "仔细一点")]} />);
    expect(screen.getByText("仔细一点")).toBeTruthy();
    expect(screen.getByText("等待引导当前任务…")).toBeTruthy();
    expect(screen.getByLabelText("编辑排队消息")).toBeTruthy();
    expect(screen.getByLabelText("删除排队消息")).toBeTruthy();
    expect(screen.queryByText("立即")).toBeNull();
  });

  it("删除走 updateQueue remove", () => {
    render(<SteerQueue sessionId="s" items={[item("a", "仔细一点")]} />);
    screen.getByLabelText("删除排队消息").click();
    expect(updateQueue).toHaveBeenCalledWith({ sessionId: "s", itemId: "a", action: { kind: "remove" } });
  });

  it("编辑就地把气泡换成输入框，保存回 updateQueue edit", async () => {
    render(<SteerQueue sessionId="s" items={[item("a", "仔细一点")]} />);
    screen.getByLabelText("编辑排队消息").click();
    const input = (await screen.findByLabelText("编辑排队消息", { selector: "input" })) as HTMLInputElement;
    expect(input.value).toBe("仔细一点");
    screen.getByLabelText("保存排队消息").click();
    expect(updateQueue).toHaveBeenCalledWith({
      sessionId: "s",
      itemId: "a",
      action: { kind: "edit", content: [{ type: "text", text: "仔细一点" }] },
    });
  });

  it("带附件的行：气泡折附件标记、编辑钮禁用，删除照旧", () => {
    const withImage: SessionQueuedItem = {
      id: "e",
      rpcId: "rpc-e",
      placement: "steering",
      message: { id: "e", content: [{ type: "image", attachment: { attachmentId: "att-1", mediaType: "image/png" } }] },
    };
    render(<SteerQueue sessionId="s" items={[withImage]} />);
    expect(screen.getByText("图片")).toBeTruthy();
    expect((screen.getByLabelText("编辑排队消息") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText("删除排队消息")).toBeTruthy();
  });
});
