// 壳按路径推回来的**拖入项**（`hostDroppedItems`）走与 ＋ 选择器同一条摄入：
// 图片内联 chip、普通文件上传 chip、文件夹转 @ 引用。
//
// 这条命令是悬浮面（药丸/胶囊面板那一投被壳的原生落点卡接走、目录投 WebKit 不认）唯一的
// 入口——它断了就是"拖进去什么都不发生"，所以把命令名与三种条目的落点钉在这里。
// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/DialogHost", () => ({ alertDialog: () => Promise.resolve() }));
vi.mock("../session/localMedia", () => ({ rememberUploadedMedia: () => {} }));

import { useComposerAttachments } from "../components/composer/useComposerAttachments";
import { installHostBridge } from "../host";

/** 只暴露 hook 的两个落点：草稿追加的文本（@ 引用走这条）与 chip 集合。 */
function Harness({ texts }: { texts: string[] }) {
  const { attachments } = useComposerAttachments({
    appendToDraft: (suffix) => { texts.push(suffix); },
    onAdded: () => {},
    hasShell: true,
    // 草稿页（没有会话）：文件 chip 停在 pending，不去打引擎——测的是摄入本身
    sessionId: null,
  });
  return <span data-testid="chips">{attachments.map((a) => a.name).join(",")}</span>;
}

describe("hostDroppedItems：壳推回来的拖入项", () => {
  afterEach(cleanup);

  it("文件夹转 @ 引用、文件与图片各成一颗 chip", () => {
    installHostBridge();
    const texts: string[] = [];
    const { getByTestId } = render(<Harness texts={texts} />);

    act(() => window.__deepDiveHost!.dispatch("hostDroppedItems", {
      items: [
        { path: "/Users/me/docs", name: "docs", isDir: true },
        { path: "/Users/me/离职证明.pdf", name: "离职证明.pdf", isDir: false, bytes: 1024 },
        { path: "/tmp/dropped.png", name: "dropped.png", isDir: false, isImage: true, base64: "AAAA" },
      ],
    }));

    // 文件夹没有字节可传：只能给路径，引擎宿主读盘
    expect(texts.join("")).toContain("docs/");
    expect(getByTestId("chips").textContent).toBe("离职证明.pdf,dropped.png");
  });

  it("别的命令不进这条（不误吃聊天浮卡的命令）", () => {
    installHostBridge();
    const texts: string[] = [];
    const { getByTestId } = render(<Harness texts={texts} />);

    act(() => window.__deepDiveHost!.dispatch("chatShow", {}));

    expect(texts).toEqual([]);
    expect(getByTestId("chips").textContent).toBe("");
  });
});
