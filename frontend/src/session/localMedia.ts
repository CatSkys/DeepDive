// 本端上传过的媒体文件字节：`attachmentId → blob: URL`。
//
// 为什么需要它：视频缩略图要的是**文件字节**，而引擎的 `session/attachment` 只服务
// 图片（实测对 file 部件回 `session/attachment-invalid` / ATTACHMENT_NOT_REFERENCED），
// 文件部件的字节拿不回来。上传时手上正好有那个 File，就顺手记一份 blob URL——
// 不复制字节（File 本来就在内存里），也不落盘；应用重启后这份缓存是空的，缩略图
// 退回按类型图标的 chip（不是空白框）。
//
// 上限 8 条：一条会话里同时挂着的媒体文件不会多，逐出最旧的（连 blob URL 一起释放）。

import { resolveFileIconName } from "./fileIcons";

const MAX = 8;
const urls = new Map<string, string>();

/** 记一条本端媒体（上传成功后调用）。 */
export function rememberLocalMedia(attachmentId: string, url: string): void {
  urls.set(attachmentId, url);
  while (urls.size > MAX) {
    const oldest = urls.keys().next().value;
    if (oldest === undefined) break;
    const dead = urls.get(oldest);
    urls.delete(oldest);
    if (dead) URL.revokeObjectURL(dead);
  }
}

/** 取本端媒体的 blob URL；没有（未上传过/已重启）时返回 undefined。 */
export function localMediaUrl(attachmentId: string): string | undefined {
  return urls.get(attachmentId);
}

/** 上传回执到手时调用（`name` 用回执里的：渲染缩略图时判的也是这个名字，同源才一致）：
 *  **视频**才留 blob URL。引擎只服务 image 部件的字节，视频是唯一按字节出缩略图的
 *  file 部件；其余文件只出图标 chip，记了也白占 8 条额度。 */
export function rememberUploadedMedia(attachmentId: string, name: string, file: Blob): void {
  if (resolveFileIconName(name) !== "video") return;
  rememberLocalMedia(attachmentId, URL.createObjectURL(file));
}
