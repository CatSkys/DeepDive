// 排队区（session/QueueDock）的交互契约（用户定稿）：一条挂起消息一枚**小胶囊**，
// 常态只显示文本（没有状态注释）；**点击**展开成整行并浮出操作，点别处收回。
// 排队（next-turn）与插话中（next-step）都摆在这里，所以两种都能编辑/删除；
// 「立即」只给排队中的（引擎对 next-step 的 steer 会拒）。
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  it("常态是小胶囊：状态词 + 文本，没有操作钮、也没有悬浮注释", () => {
    render(<QueueDock sessionId="s" items={[item("a", "改一下标题", "queued")]} />);
    expect(screen.getByText("改一下标题")).toBeTruthy();
    expect(screen.getByText("排队中")).toBeTruthy();
    // 胶囊上不挂 data-tip（悬浮注释与胶囊里的文本重复，用户定稿去掉）
    expect(screen.getByText("改一下标题").getAttribute("data-tip")).toBeNull();
    expect(screen.queryByText("立即")).toBeNull();
    expect(screen.queryByLabelText("编辑排队消息")).toBeNull();
    expect(screen.queryByLabelText("删除排队消息")).toBeNull();
  });

  it("点击展开：排队中的消息有立即/编辑/删除三枚操作", async () => {
    render(<QueueDock sessionId="s" items={[item("a", "改一下标题", "queued")]} />);
    screen.getByText("改一下标题").click();
    expect(await screen.findByText("立即")).toBeTruthy();
    expect(screen.getByLabelText("编辑排队消息")).toBeTruthy();
    expect(screen.getByLabelText("删除排队消息")).toBeTruthy();
  });

  it("点击展开：插话中的消息照样可编辑/删除，只是没有立即（引擎会拒）", async () => {
    render(<QueueDock sessionId="s" items={[item("b", "先别打包", "steering")]} />);
    expect(screen.getByText("插话中")).toBeTruthy();
    screen.getByText("先别打包").click();
    expect(await screen.findByLabelText("编辑排队消息")).toBeTruthy();
    expect(screen.getByLabelText("删除排队消息")).toBeTruthy();
    expect(screen.queryByText("立即")).toBeNull();
  });

  it("点别处收回（点 dock 之外即缩回小胶囊）", async () => {
    render(<QueueDock sessionId="s" items={[item("c", "跑下测试", "queued")]} />);
    screen.getByText("跑下测试").click();
    expect(await screen.findByText("立即")).toBeTruthy();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await waitFor(() => expect(screen.queryByText("立即")).toBeNull());
  });

  it("带附件的排队消息：常态折成标记，展开后出真附件带（缩略图/文件 chip），编辑钮禁用", async () => {
    const withFiles: SessionQueuedItem = {
      id: "e",
      rpcId: "rpc-e",
      placement: "queued",
      message: {
        id: "e",
        content: [
          { type: "image", attachment: { attachmentId: "att-1", mediaType: "image/png" } },
          { type: "file", attachment: { attachmentId: "att-2", name: "报告.pdf", bytes: 2048 } },
        ],
      },
    };
    const { container } = render(<QueueDock sessionId="s" items={[withFiles]} />);
    // 常态：只有文本标记（图片 / 文件），没有真附件带
    expect(screen.getByText("排队中")).toBeTruthy();
    expect(screen.getByText("图片 · 文件")).toBeTruthy();
    expect(container.querySelector(".user-attachments")).toBeNull();
    // 展开：出附件带——图片缩略图 + 文件 chip（图标 + 名字 + 大小）
    screen.getByText("图片 · 文件").click();
    expect(await screen.findByText("报告.pdf")).toBeTruthy();
    expect(container.querySelector(".user-attachments .user-attachment-thumb")).toBeTruthy();
    expect(container.querySelector(".user-attachments .user-file-chip")).toBeTruthy();
    // 引擎的排队编辑只收文本（改一次就丢附件）：编辑钮禁用，立即/删除照旧
    const edit = await screen.findByLabelText("编辑排队消息");
    expect((edit as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText("删除排队消息")).toBeTruthy();
    expect(screen.getByText("立即")).toBeTruthy();
  });

  it("展开后点编辑：文本装进输入框（保存/取消两枚钮）", async () => {
    render(<QueueDock sessionId="s" items={[item("d", "跑下测试", "queued")]} />);
    screen.getByText("跑下测试").click();
    (await screen.findByLabelText("编辑排队消息")).click();
    const input = await screen.findByLabelText("编辑排队消息", { selector: "input" });
    expect((input as HTMLInputElement).value).toBe("跑下测试");
    expect(screen.getByLabelText("保存排队消息")).toBeTruthy();
    expect(screen.getByLabelText("取消编辑")).toBeTruthy();
  });
});
