// 附件胶囊（输入框里的行内原子与会话里用户消息共用同一颗）：
//   · 形状：类型图标 + 名字（+ 状态一截）；只有调用方给了 onRemove 才有移除钮；
//   · 媒体悬停出画面——**画面由调用方给**（preview prop），所以"哪类附件算媒体"这条判据
//     在编辑器/消息那两处适配层（见 composer-attach-layout 与 queue-dock 的用例）。
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AttachmentPill } from "../components/AttachmentPill";

afterEach(cleanup);

const noop = () => {};
/** 词典桩：源串即回退。 */
const t = (zh: string) => zh;

const pic = { src: "data:image/png;base64,AAAA", video: false };

/** 预览画面挂在 body 上（portal：输入框那颗住在编辑器的滚动容器里，留在原地会被裁）。 */
const preview = () => document.querySelector(".att-preview");

function renderPill(props: Partial<React.ComponentProps<typeof AttachmentPill>> = {}) {
  return render(<AttachmentPill name="截图.png" icon="image" t={t} {...props} />);
}

/** 悬停这颗胶囊（指针进场）。 */
function hover(container: HTMLElement) {
  fireEvent.mouseEnter(container.querySelector(".att-chip")!);
}

describe("附件胶囊", () => {
  it("给了画面就悬停出画面；没给就不出（判据在调用方）", () => {
    const withPic = renderPill({ preview: pic, onOpen: noop });
    expect(preview()).toBeNull();
    hover(withPic.container);
    expect(document.querySelector(".att-preview img")).not.toBeNull();
    withPic.unmount();
    const plain = renderPill();
    hover(plain.container);
    expect(preview()).toBeNull();
  });

  it("视频画面用 video 元素（首帧）", () => {
    const { container } = renderPill({ preview: { src: "blob:x", video: true } });
    hover(container);
    expect(document.querySelector(".att-preview video")).not.toBeNull();
  });

  it("下方放不下就翻到胶囊上方（输入框钉在会话底那一档）", () => {
    const original = Element.prototype.getBoundingClientRect;
    const bottom = window.innerHeight - 20;
    Element.prototype.getBoundingClientRect = function () {
      return { x: 0, y: bottom - 26, left: 0, top: bottom - 26, right: 120, bottom, width: 120, height: 26, toJSON: () => ({}) } as DOMRect;
    };
    try {
      const { container } = renderPill({ preview: pic });
      hover(container);
      expect(document.querySelector(".att-preview.above")).not.toBeNull();
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });

  it("下方放得下就开在下方（草稿页那种四周有地方的一档）", () => {
    const original = Element.prototype.getBoundingClientRect;
    const bottom = 200;
    Element.prototype.getBoundingClientRect = function () {
      return { x: 0, y: bottom - 26, left: 0, top: bottom - 26, right: 120, bottom, width: 120, height: 26, toJSON: () => ({}) } as DOMRect;
    };
    try {
      const { container } = renderPill({ preview: pic });
      hover(container);
      expect(document.querySelector(".att-preview.above")).toBeNull();
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });

  it("名字与状态摆在同一颗上；移除钮只在给得起时才有（消息里那颗删不掉）", () => {
    const { container } = renderPill({ icon: "file", name: "spec.pdf", meta: "2.0 KB", onRemove: noop });
    expect(screen.getByText("spec.pdf")).not.toBeNull();
    expect(screen.getByText("2.0 KB")).not.toBeNull();
    expect(screen.getByRole("button", { name: "删除" })).not.toBeNull();
    expect(container.querySelector(".att-chip")?.getAttribute("data-removable")).toBe("true");
    cleanup();
    const { container: bare } = renderPill({ onRemove: undefined });
    expect(bare.querySelector(".att-chip-x")).toBeNull();
    expect(bare.querySelector(".att-chip")?.getAttribute("data-removable")).toBeNull();
  });

  it("失败态：重试钮在、状态一截标红", () => {
    const { container } = renderPill({ icon: "file", name: "spec.pdf", status: "error", meta: "上传失败", onRetry: noop, onRemove: noop });
    expect(container.querySelector(".att-chip-meta.failed")).not.toBeNull();
    expect(screen.getByText("重试")).not.toBeNull();
    expect(container.querySelector(".att-chip")?.getAttribute("data-status")).toBe("error");
  });

  it("上传中：图标位换成转圈", () => {
    const { container } = renderPill({ icon: "file", name: "spec.pdf", status: "uploading", busy: true, meta: "上传中 42%" });
    expect(container.querySelector(".att-chip-spin")).not.toBeNull();
    expect(container.querySelector(".file-icon")).toBeNull();
  });
});
