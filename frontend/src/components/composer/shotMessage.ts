// 「截图带话」那条消息的载荷拼装（截图工具条上的「提问」）：话在前，随后是本批内联的图，
// 最后是文件回执（图被引擎的图片准入拒收时改走的那一份）。只管这层纯拼装；建会话、上传、
// 发送的编排在 Composer.tsx 的 `sendShotMessage`（与划词命令同一口径：不经输入框草稿）。

import type { PickedAttachment } from "../../host";
import type { PromptContentPart } from "../../types";
import { pickedDelivery, type ShotImage } from "./useComposerAttachments";

/** 壳回来的那批截图项分成两拨：随消息内联的图（模型才看得见）与要传成回执的文件。壳的
 *  截图产物只有那张图，文件这一拨留给"图没带字节 / 认不出扩展名"那几种（判据与 ＋ 选择器
 *  共用，不在这里再判一遍）；文件夹走不到这里。 */
export function splitShotItems(items: PickedAttachment[]): {
  images: ShotImage[];
  files: PickedAttachment[];
} {
  const images: ShotImage[] = [];
  const files: PickedAttachment[] = [];
  for (const item of items) {
    const delivery = pickedDelivery(item);
    if (delivery.kind === "image") {
      images.push({ name: item.name, mediaType: delivery.mime, data: delivery.base64 });
    } else if (delivery.kind === "file") {
      files.push(item);
    }
  }
  return { images, files };
}

/** 载荷：话在前（空话不发文本部件——只发图是允许的，与输入框的发送门槛同款），
 *  随后内联图，最后文件回执。图被引擎的图片准入拒了就改传回执重投（`images` 传空、
 *  回执里补上它们那一份），这条函数不用知道是哪一种。 */
export function shotMessageContent(
  text: string,
  images: ShotImage[],
  fileReceiptIds: string[],
): PromptContentPart[] {
  const parts: PromptContentPart[] = [];
  const body = text.trim();
  if (body) parts.push({ type: "text", text: body });
  for (const image of images) {
    parts.push({ type: "image", mediaType: image.mediaType, data: image.data, name: image.name });
  }
  for (const receiptId of fileReceiptIds) parts.push({ type: "file", receiptId });
  return parts;
}
