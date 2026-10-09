// 输入框文件 chip 名字右边那一截（fileMeta）的四态说法。钉住"失败摆原因原话"这条
// 规则（用户 2026-10-09 定稿：参考成熟产品的状态列——只说"上传失败"等于让人去猜），
// 以及大小与消息里那颗文件 chip 同源。
import { describe, expect, it } from "vitest";
import { fileMeta } from "../components/composer/fileMeta";
import type { FileAttachment } from "../components/composer/useComposerAttachments";

const att = (patch: Partial<FileAttachment>): FileAttachment =>
  ({ id: "a", kind: "file", name: "x.pdf", status: "ready", ...patch });

/** 词典未命中的回退就是源串，所以这里直接用恒等函数当 t。 */
const t = (s: string) => s;

describe("fileMeta", () => {
  it("就绪摆大小（与消息里那颗文件 chip 同一个 sizeText）", () => {
    expect(fileMeta(att({ bytes: 1536 }), t)).toBe("1.5 KB");
    expect(fileMeta(att({ bytes: undefined }), t)).toBe("");
  });

  it("上传中带百分比；没有进度回调就只说上传中", () => {
    expect(fileMeta(att({ status: "uploading", progress: 42 }), t)).toBe("上传中 42%");
    expect(fileMeta(att({ status: "uploading" }), t)).toBe("上传中");
  });

  it("草稿页（还没有会话可传）说待发送", () => {
    expect(fileMeta(att({ status: "pending" }), t)).toBe("待发送");
  });

  it("失败摆原因原话；没拿到原话才回落到「上传失败」", () => {
    expect(fileMeta(att({ status: "error", error: "超过 32 MB 上传上限" }), t)).toBe("超过 32 MB 上传上限");
    expect(fileMeta(att({ status: "error" }), t)).toBe("上传失败");
  });
});
