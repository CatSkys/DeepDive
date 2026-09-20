// 附件准入拒绝的客户端处置口径。引擎的 `session/attachment-invalid` 系列只否掉
// **附件本身**（模型不吃图、图片太大、文件没传完…），消息正文是好的——所以不把
// 整条消息挡死：丢掉被拒的那一类部件重发一次，并如实说明丢了什么。判类依据是
// 引擎 wire 的 `details.reason` 码（官方 UI 也按同一组码分派文案），码里带 IMAGE
// 的就是图片类、带 FILE 的是文件类；认不出的码不猜（返回 undefined = 照常报错）。

import type { PromptContentPart } from "./types";

/** 被拒的部件类别（决定重发时丢哪一类）。 */
export type AttachmentDropClass = "images" | "files";

export function classifyAttachmentRefusal(reason: string | undefined): AttachmentDropClass | undefined {
  if (!reason) return undefined;
  if (reason.includes("IMAGE")) return "images";
  if (reason.includes("FILE")) return "files";
  return undefined;
}

/** 去掉某一类附件部件；正文留空（只剩附件）时返回 null——没正文可发就不重发，
 *  由调用方照常报错。 */
export function dropAttachmentParts(
  content: PromptContentPart[],
  drop: AttachmentDropClass,
): PromptContentPart[] | null {
  const marker = drop === "images" ? "image" : "file";
  const kept = content.filter((part) => part.type !== marker);
  return kept.length === content.length || !kept.some((part) => part.type === "text") ? null : kept;
}
