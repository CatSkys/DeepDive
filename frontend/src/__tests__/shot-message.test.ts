// 「截图带话」那条消息的载荷拼装（components/composer/shotMessage.ts）：
// ① 壳回来的 items 分两拨——能内联的图（模型才看得见）与只能按路径走的文件；
// ② 载荷次序：话在前、图随后、回执最后；空话不发文本部件；
// ③ 图被引擎拒收后的重投形态（图改传回执）由同一条函数拼出来，不另写一份。
import { describe, expect, it } from "vitest";

import { shotMessageContent, splitShotItems } from "../components/composer/shotMessage";
import type { PickedAttachment } from "../host";

const picked = (p: Partial<PickedAttachment> & { name: string }): PickedAttachment =>
  ({ path: `/tmp/${p.name}`, isDir: false, ...p });

/** 壳侧一次截图的产出：那张标注图（图片名 + base64）。 */
const shotItems = (): PickedAttachment[] => [
  picked({ name: "shot.png", isImage: true, base64: "AAAA", bytes: 4 }),
];

describe("splitShotItems：图内联", () => {
  it("图片按扩展名定 MIME；一次截图就带这一张图，没有别的文件", () => {
    const { images, files } = splitShotItems(shotItems());
    expect(images).toEqual([{ name: "shot.png", mediaType: "image/png", data: "AAAA" }]);
    expect(files).toEqual([]);
  });

  it("认不出扩展名的图片按文件办（与 ＋ 选择器同一条判据）", () => {
    const { images, files } = splitShotItems([picked({ name: "shot.tiff", isImage: true, base64: "AAAA" })]);
    expect(images).toHaveLength(0);
    expect(files).toHaveLength(1);
  });

  it("没带字节的图片也按文件办——内联无从谈起", () => {
    const { images, files } = splitShotItems([picked({ name: "shot.png", isImage: true })]);
    expect(images).toHaveLength(0);
    expect(files).toHaveLength(1);
  });
});

describe("shotMessageContent：话在前，图随后，回执最后", () => {
  it("带话：文本、内联图、文件回执各一份，次序即消息次序", () => {
    const { images } = splitShotItems(shotItems());
    expect(shotMessageContent("这里为什么报错？", images, ["receipt-1"])).toEqual([
      { type: "text", text: "这里为什么报错？" },
      { type: "image", mediaType: "image/png", data: "AAAA", name: "shot.png" },
      { type: "file", receiptId: "receipt-1" },
    ]);
  });

  it("空话（只发图）不发文本部件，前后空白也不算话", () => {
    const { images } = splitShotItems(shotItems());
    expect(shotMessageContent("   ", images, [])).toEqual([
      { type: "image", mediaType: "image/png", data: "AAAA", name: "shot.png" },
    ]);
  });

  it("重投形态：图改传回执后没有内联图，回执按序接上", () => {
    expect(shotMessageContent("看看这张", [], ["context-1", "image-1"])).toEqual([
      { type: "text", text: "看看这张" },
      { type: "file", receiptId: "context-1" },
      { type: "file", receiptId: "image-1" },
    ]);
  });
});
