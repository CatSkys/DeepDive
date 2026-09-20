// 附件准入拒绝的判类钉子：只看引擎 wire 的 details.reason，认不出不猜——
// 判类决定编排方怎么把附件换成等效投递（图片改走文件回执），不决定丢不丢。
import { describe, expect, it } from "vitest";
import { classifyAttachmentRefusal, classifyAttachmentRefusalText } from "../attachmentRefusal";

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

describe("classifyAttachmentRefusalText（命令路径：只有引擎原文）", () => {
  it("收据失效判成文件类（commands 的 admitCommandAttachments 原文）", () => {
    expect(classifyAttachmentRefusalText("File upload receipt is unknown for this session.")).toBe("files");
  });

  it("引擎的图片限额/格式原文判成图片类（attachment-local 的 AttachmentError）", () => {
    expect(classifyAttachmentRefusalText("Image exceeds the configured byte limit.")).toBe("images");
    expect(classifyAttachmentRefusalText("Unsupported or malformed image data.")).toBe("images");
  });

  it("读文件失败判成文件类；其他错误不猜", () => {
    expect(classifyAttachmentRefusalText("Unable to read file attachment.")).toBe("files");
    expect(classifyAttachmentRefusalText("/foo does not accept attachments")).toBeUndefined();
    expect(classifyAttachmentRefusalText(undefined)).toBeUndefined();
  });
});
