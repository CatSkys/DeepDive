// 输入框里的附件胶囊（用户 2026-10-14 定稿）：所有附件一个形状（图标 + 名 + 状态），
// **媒体文件悬停才出预览画面，且仅限媒体**——pdf/zip/文本这些悬停不弹东西。
// 这里钉住预览的开关与画面元素（图片/视频两档）；预览开在下方还是上方（贴底翻转）
// 是几何，jsdom 不排版、量不了，归 UI-SPEC §2.2。
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttachmentPill } from "../components/composer/AttachmentPill";
import type { Attachment } from "../components/composer/useComposerAttachments";

vi.mock("../store", () => ({ useStore: () => ({ lang: "zh", keybinds: undefined }) }));

// jsdom 没有 blob URL 那对接口（预览要给它一份文件字节）
if (!URL.createObjectURL) {
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => {};
}

afterEach(cleanup);

const noop = () => {};
const IMAGE: Attachment = { id: "a1", kind: "image", data: "AAAA", mediaType: "image/png", name: "shot.png" };
const VIDEO: Attachment = {
  id: "a2", kind: "file", name: "clip.mp4", bytes: 1024, status: "ready",
  file: new File(["x"], "clip.mp4", { type: "video/mp4" }),
};
const PDF: Attachment = {
  id: "a3", kind: "file", name: "spec.pdf", bytes: 2048, status: "ready",
  file: new File(["x"], "spec.pdf", { type: "application/pdf" }),
};
/** 壳选择器挑来的文件：只有路径、没有字节。 */
const PATH_ONLY: Attachment = { id: "a4", kind: "file", name: "clip.mov", status: "ready", path: "/tmp/clip.mov" };

function renderPill(att: Attachment) {
  return render(<AttachmentPill att={att} onRemove={noop} onRetry={noop} onOpenImage={noop} />);
}

/** 悬停这颗胶囊（指针进场）。 */
function hover(container: HTMLElement) {
  fireEvent.mouseEnter(container.querySelector(".att-chip")!);
}

describe("附件胶囊", () => {
  it("图片：悬停出预览画面；胶囊点得开 Lightbox（字节常驻）", () => {
    const { container } = renderPill(IMAGE);
    expect(container.querySelector(".att-preview")).toBeNull();
    hover(container);
    expect(container.querySelector(".att-preview img")).not.toBeNull();
    expect(container.querySelector(".att-chip")?.getAttribute("data-open")).toBe("lightbox");
  });

  it("视频：悬停出首帧画面", () => {
    const { container } = renderPill(VIDEO);
    expect(container.querySelector(".att-preview")).toBeNull();
    hover(container);
    expect(container.querySelector(".att-preview video")).not.toBeNull();
  });

  it("非媒体（pdf）：悬停不弹预览", () => {
    const { container } = renderPill(PDF);
    hover(container);
    expect(container.querySelector(".att-preview")).toBeNull();
  });

  it("只有路径、没有字节的媒体：不摆空白预览框", () => {
    const { container } = renderPill(PATH_ONLY);
    hover(container);
    expect(container.querySelector(".att-preview")).toBeNull();
  });

  it("名字与状态摆在同一颗胶囊上，移除钮带无障碍名字", () => {
    renderPill(PDF);
    expect(screen.getByText("spec.pdf")).not.toBeNull();
    expect(screen.getByText("2.0 KB")).not.toBeNull();
    expect(screen.getByRole("button", { name: "删除" })).not.toBeNull();
  });
});
