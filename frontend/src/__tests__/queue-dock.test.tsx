// 排队区（session/QueueDock）的交互契约（用户定稿）：一条排队消息（next-turn）
// 一枚**小胶囊**，常态只显示文本（没有状态注释）；**点击**展开成整行并浮出操作，
// 点别处收回；「立即」把它转成插话（next-step）。插话中的消息不摆这里——那条
// 走消息形态（SteerQueue，用户 2026-10-10 定稿）。
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { QueueDock } from "../session/QueueDock";
import type { SessionQueuedItem } from "../types";
import { rememberLocalMedia } from "../session/localMedia";

const item = (id: string, text: string): SessionQueuedItem => ({
  id,
  rpcId: `rpc-${id}`,
  placement: "queued",
  message: { id, content: [{ type: "text", text }] },
});

afterEach(cleanup);

describe("QueueDock", () => {
  it("常态是小胶囊：状态词 + 文本，没有操作钮、也没有悬浮注释", () => {
    render(<QueueDock sessionId="s" items={[item("a", "改一下标题")]} />);
    expect(screen.getByText("改一下标题")).toBeTruthy();
    expect(screen.getByText("排队中")).toBeTruthy();
    // 胶囊上不挂 data-tip（悬浮注释与胶囊里的文本重复，用户定稿去掉）
    expect(screen.getByText("改一下标题").getAttribute("data-tip")).toBeNull();
    expect(screen.queryByText("立即")).toBeNull();
    expect(screen.queryByLabelText("编辑排队消息")).toBeNull();
    expect(screen.queryByLabelText("删除排队消息")).toBeNull();
  });

  it("点击展开：排队中的消息有立即/编辑/删除三枚操作", async () => {
    render(<QueueDock sessionId="s" items={[item("a", "改一下标题")]} />);
    screen.getByText("改一下标题").click();
    expect(await screen.findByText("立即")).toBeTruthy();
    expect(screen.getByLabelText("编辑排队消息")).toBeTruthy();
    expect(screen.getByLabelText("删除排队消息")).toBeTruthy();
  });

  it("点别处收回（点 dock 之外即缩回小胶囊）", async () => {
    render(<QueueDock sessionId="s" items={[item("c", "跑下测试")]} />);
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
    // 展开：出附件带——**一律胶囊**（与输入框里那颗同一个组件）
    screen.getByText("图片 · 文件").click();
    expect(await screen.findByText("报告.pdf")).toBeTruthy();
    expect(container.querySelectorAll(".user-attachments .att-chip")).toHaveLength(2);
    // 胶囊出**按类型**的图标（FileIcon 的 .file-icon）：pdf 与 txt 的图标必须不同
    const pdfIcon = container.querySelector(".att-chip .file-icon")?.innerHTML ?? "";
    expect(pdfIcon).toContain("svg");
    const txt = render(<QueueDock sessionId="s" items={[{ ...withFiles, id: "t", message: { id: "t", content: [{ type: "file", attachment: { attachmentId: "att-3", name: "笔记.txt", bytes: 10 } }] } }]} />);
    expect(txt.container.querySelector(".att-chip .file-icon")?.innerHTML).not.toBe(pdfIcon);
    // 引擎的排队编辑只收文本（改一次就丢附件）：编辑钮禁用，立即/删除照旧
    const edit = await screen.findByLabelText("编辑排队消息");
    expect((edit as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText("删除排队消息")).toBeTruthy();
    expect(screen.getByText("立即")).toBeTruthy();
  });

  it("视频附件：本端有字节时胶囊带首帧悬停画面，没有则只是胶囊", async () => {
    const withVideo: SessionQueuedItem = {
      id: "v",
      rpcId: "rpc-v",
      placement: "queued",
      message: { id: "v", content: [{ type: "file", attachment: { attachmentId: "att-v", name: "clip.mp4", bytes: 1024 } }] },
    };
    // 没有本端字节（历史回放/重启后）：还是胶囊（按类型图标），只是悬停不弹画面
    const bare = render(<QueueDock sessionId="s" items={[withVideo]} />);
    screen.getByText("视频").click();
    expect(await screen.findByText("clip.mp4")).toBeTruthy();
    const bareChip = bare.container.querySelector(".user-attachments .att-chip")!;
    expect(bareChip).toBeTruthy();
    fireEvent.mouseEnter(bareChip);
    expect(document.querySelector(".att-preview")).toBeNull();
    bare.unmount();
    // 本端刚上传过（blob URL 在）：同一颗胶囊，悬停出首帧画面
    rememberLocalMedia("att-v", "blob:probe");
    const { container } = render(<QueueDock sessionId="s" items={[withVideo]} />);
    screen.getByText("视频").click();
    await screen.findByText("立即"); // 等展开这一帧落定，再查附件带的形状
    const chip = container.querySelector(".user-attachments .att-chip")!;
    expect(chip).toBeTruthy();
    fireEvent.mouseEnter(chip);
    expect(document.querySelector(".att-preview video")).toBeTruthy();
  });

  it("展开后点编辑：文本装进输入框（保存/取消两枚钮）", async () => {
    render(<QueueDock sessionId="s" items={[item("d", "跑下测试")]} />);
    screen.getByText("跑下测试").click();
    (await screen.findByLabelText("编辑排队消息")).click();
    const input = await screen.findByLabelText("编辑排队消息", { selector: "input" });
    expect((input as HTMLInputElement).value).toBe("跑下测试");
    expect(screen.getByLabelText("保存排队消息")).toBeTruthy();
    expect(screen.getByLabelText("取消编辑")).toBeTruthy();
  });
});
