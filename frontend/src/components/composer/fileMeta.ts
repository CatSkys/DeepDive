// 输入框那颗文件 chip 名字右边一截的文字（待发送 / 上传中 42% / 失败原因 / 大小）。
// 独立成文件：这是一段纯换算，chip 本体（Composer.tsx）只管怎么画。大小走 sizeText
// ——消息里那颗文件 chip 也是它（一处口径，两处显示）。
import { sizeText } from "../../session/format";
import type { FileAttachment } from "./useComposerAttachments";

/** 失败摆的是原因原话（壳/引擎给的）：截断交给 CSS、全文交给 chip 的 tooltip——
 *  只说"上传失败"等于让用户去猜为什么（与 ZCode 的状态列同一职责）。 */
export function fileMeta(f: FileAttachment, t: (zh: string) => string): string {
  if (f.status === "error") return f.error || t("上传失败");
  if (f.status === "uploading") return f.progress !== undefined ? `${t("上传中")} ${f.progress}%` : t("上传中");
  if (f.status === "pending") return t("待发送");
  return sizeText(f.bytes);
}
