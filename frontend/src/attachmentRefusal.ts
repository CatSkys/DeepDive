// 附件准入拒绝的判类。引擎的 `session/attachment-invalid` 系列只否掉**附件本身**
// （模型条目没声明图片能力、图片太大、文件没传完…），内容与正文都是好的——用户定稿：
// 附件与内容必须发出去，跟模型无关。所以这里的结论不用于「丢附件」，只用于挑等效
// 投递：判到图片类就把这批图片按通用文件原件重投（同一份字节走文件回执），发送不
// 被打断。判类依据是引擎 wire 的 `details.reason` 码（官方 UI 也按同一组码分派），
// 码里带 IMAGE 的是图片类、带 FILE 的是文件类；认不出的码不猜（undefined = 照常报错）。

/** 被拒的附件类别（决定用哪种等效投递重发）。 */
export type AttachmentRefusalClass = "images" | "files";

export function classifyAttachmentRefusal(reason: string | undefined): AttachmentRefusalClass | undefined {
  if (!reason) return undefined;
  if (reason.includes("IMAGE")) return "images";
  if (reason.includes("FILE")) return "files";
  return undefined;
}
