// 附件摄入的判据（纯函数，无 React）：壳给的条目 → 「收成图片 chip / 转 @ 引用 / 说一句」。
// 规则与理由见 useComposerAttachments.ts 的文件头（图片收字节、其余一律引用）。
// 单独成文件是为了能直接单测——它是"拖入/选择器到底发生了什么"的唯一判据。

import { formatMention } from "../../atGrammar";
import { tt } from "../../i18n";
import type { PickedAttachment } from "../../host";

/** 随消息内联的**图片**字节上限＝桥的单请求上限（MiniHTTPServer.maxBodyBytes，超了 413）。
 *  只影响"能不能内联给模型看"：超了不弹错，改走 @ 引用（引擎自己读），附件照样发得出去。 */
export const MAX_INLINE_IMAGE_BYTES = 32 * 1024 * 1024;

const IMAGE_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};

/** 图片大到没法内联时的说明（它会转成 @ 引用，不是被丢掉）。 */
export function tooLargeImageNote(name: string): string {
  return tt(`「${name}」超过 32 MB，已改为 @ 引用`, `"${name}" exceeds 32 MB and was added as an @ reference instead`);
}

/** 没有壳、也就没有路径可引用时的话（桌面应用里同一次拖入会变成引用）。 */
export function noPathNote(name: string): string {
  return tt(`「${name}」在这里拿不到路径，无法引用（请在桌面应用里拖入）`,
    `"${name}" exposes no path here, so it cannot be referenced (drag it in the desktop app)`);
}

/** 路径 → 自闭合的 @ 引用（目录带引号时 formatMention 保持开引用供续层，
 *  选择器/拖拽插入的是完整引用，补收引号）。 */
export function mentionOf(path: string, isDir: boolean): string | undefined {
  const m = formatMention({ path, kind: isDir ? "directory" : "file" }, false);
  if (m === undefined) return undefined;
  return m.startsWith(`@"`) && !m.endsWith(`"`) ? `${m}"` : m;
}

/** 一次摄入的处置结果：收成 chip 的图片、要插进草稿的引用、要当场说出口的话。 */
export interface IngestPlan {
  images: Array<{ data: string; mediaType: string; name: string }>;
  mentions: string[];
  notes: string[];
}

/** 壳给的条目（选择器与拖入同一形状）→ 计划。图片带字节就收 chip，
 *  其余（含超出内联上限的图片）转 @ 引用；超大图片明说一句，别让用户以为没内联是丢了。 */
export function planIngest(items: PickedAttachment[]): IngestPlan {
  const plan: IngestPlan = { images: [], mentions: [], notes: [] };
  for (const it of items) {
    const mime = IMAGE_MIME[it.name.split(".").pop()?.toLowerCase() ?? ""];
    if (it.isImage && it.base64 && mime) {
      plan.images.push({ data: it.base64, mediaType: mime, name: it.name });
      continue;
    }
    if (it.isImage && !it.isDir) plan.notes.push(tooLargeImageNote(it.name));
    const m = mentionOf(it.path, it.isDir);
    if (m) plan.mentions.push(m);
  }
  return plan;
}
