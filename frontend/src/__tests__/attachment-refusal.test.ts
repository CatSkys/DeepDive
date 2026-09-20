// 附件准入拒绝的处置钉子：判类只看引擎 wire 的 details.reason，认不出不猜；
// 「丢掉被拒的那类部件」必须保住正文，没正文可发就返回 null（调用方照常报错）。
import { describe, expect, it } from "vitest";
import { classifyAttachmentRefusal, dropAttachmentParts } from "../attachmentRefusal";
import type { PromptContentPart } from "../types";

const img: PromptContentPart = { type: "image", mediaType: "image/png", data: "AA==" };
const file: PromptContentPart = { type: "file", receiptId: "r1" };
const text: PromptContentPart = { type: "text", text: "看看这个" };

describe("classifyAttachmentRefusal", () => {
  // 引擎现役的全部拒绝码（dsh-attachment / dsh-api-session-controller 实测枚举），
  // 每一个都必须被判类——新增码时这里同步，别让某类附件悄悄退化成"整条报错"。
  it("图片类码全部 → images", () => {
    for (const code of [
      "MODEL_DOES_NOT_SUPPORT_IMAGES",
      "INVALID_IMAGE",
      "UNSUPPORTED_IMAGE_TYPE",
      "IMAGE_TYPE_MISMATCH",
      "IMAGE_TOO_LARGE",
      "IMAGES_TOO_LARGE",
      "IMAGE_TOO_MANY_PIXELS",
      "IMAGE_DIMENSION_TOO_LARGE",
      "TOO_MANY_IMAGES",
    ]) expect(classifyAttachmentRefusal(code), code).toBe("images");
  });

  it("文件类码全部 → files", () => {
    expect(classifyAttachmentRefusal("FILE_NOT_STAGED")).toBe("files");
  });

  it("认不出的码与缺失一律 undefined（不猜，照常报错）", () => {
    expect(classifyAttachmentRefusal("SOMETHING_ELSE")).toBeUndefined();
    expect(classifyAttachmentRefusal(undefined)).toBeUndefined();
  });
});

describe("dropAttachmentParts", () => {
  it("丢图片保正文；文件部件不动", () => {
    expect(dropAttachmentParts([img, file, text], "images")).toEqual([file, text]);
    expect(dropAttachmentParts([img, file, text], "files")).toEqual([img, text]);
  });

  it("没有该类部件、或丢完只剩附件 → null", () => {
    expect(dropAttachmentParts([text], "images")).toBeNull();
    expect(dropAttachmentParts([img], "images")).toBeNull();
    expect(dropAttachmentParts([file], "files")).toBeNull();
  });
});
