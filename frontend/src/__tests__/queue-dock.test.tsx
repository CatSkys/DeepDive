// 排队区（session/QueueDock）的呈现契约：一条挂起消息一枚胶囊，排队（next-turn）
// 与插话中（next-step）都摆——两种都能编辑/删除；「立即」只给排队中的（引擎对
// next-step 的 steer 会拒），插话中的行靠状态词说明为什么少了那枚钮。
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { QueueDock } from "../session/QueueDock";
import type { SessionQueuedItem } from "../types";

const item = (id: string, text: string, placement: "queued" | "steering"): SessionQueuedItem => ({
  id,
  rpcId: `rpc-${id}`,
  placement,
  message: { id, content: [{ type: "text", text }] },
});

afterEach(cleanup);

describe("QueueDock", () => {
  it("排队中的消息有立即/编辑/删除三枚操作", () => {
    render(<QueueDock sessionId="s" items={[item("a", "改一下标题", "queued")]} />);
    expect(screen.getByText("改一下标题")).toBeTruthy();
    expect(screen.getByText("排队中")).toBeTruthy();
    expect(screen.getByText("立即")).toBeTruthy();
    expect(screen.getByLabelText("编辑排队消息")).toBeTruthy();
    expect(screen.getByLabelText("删除排队消息")).toBeTruthy();
  });

  it("插话中的消息照样可编辑/删除，只是没有立即（引擎会拒）", () => {
    render(<QueueDock sessionId="s" items={[item("b", "先别打包", "steering")]} />);
    expect(screen.getByText("插话中")).toBeTruthy();
    expect(screen.queryByText("立即")).toBeNull();
    expect(screen.getByLabelText("编辑排队消息")).toBeTruthy();
    expect(screen.getByLabelText("删除排队消息")).toBeTruthy();
  });

  it("编辑态把文本装进输入框（保存/取消两枚钮）", async () => {
    render(<QueueDock sessionId="s" items={[item("c", "跑下测试", "queued")]} />);
    screen.getByLabelText("编辑排队消息").click();
    const input = await screen.findByLabelText("编辑排队消息", { selector: "input" });
    expect((input as HTMLInputElement).value).toBe("跑下测试");
    expect(screen.getByLabelText("保存排队消息")).toBeTruthy();
    expect(screen.getByLabelText("取消编辑")).toBeTruthy();
  });
});
