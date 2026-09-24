// 会话产物清单的派生（纯函数）。两个消费方共用同一份合并与去重口径：
// 正文里逐轮的产物行（session/ToolRow 的 ArtifactsRow）与右侧边栏的「产物」区。
//
// 数据来源是 renderModel 在 finalizeTurns 时挂到 turn-tail 上的两个字段：
// presented（present 工具声明的交付文件）与 produced（mutation 白名单推导出的写入路径）。
// 跨轮按绝对路径去重：presented 优先（它带模型给的描述），produced 补漏。

import { renderersOf } from "../components/preview/previewModel";
import type { PresentedFile } from "../types";
import type { RenderItem } from "../session/renderModel";

export interface ArtifactItem {
  /** React key：交付项与产物项前缀不同，避免同路径两次入列时撞键。 */
  key: string;
  /** 绝对路径（相对路径已用 root 拼好）。 */
  path: string;
  desc?: string;
  /** 该路径由图片渲染器承接（决定出不出缩略图）。 */
  image: boolean;
}

/** 相对路径的解析根：会话工作目录优先，调用方缺省时退回工作区路径。 */
export function absoluteArtifactPath(path: string, root?: string): string {
  return path.startsWith("/") || !root ? path : `${root}/${path}`;
}

/** 合并一轮的 produced + presented，按绝对路径去重（presented 先入、带描述）。 */
export function mergeArtifacts(produced: string[], presented: PresentedFile[], root?: string): ArtifactItem[] {
  const items: ArtifactItem[] = [];
  const seen = new Set<string>();
  for (const f of presented) {
    const path = absoluteArtifactPath(f.path, root);
    if (seen.has(path)) continue;
    seen.add(path);
    items.push({ key: `d:${f.path}`, path, desc: f.description, image: renderersOf(path).includes("image") });
  }
  for (const p of produced) {
    const path = absoluteArtifactPath(p, root);
    if (seen.has(path)) continue;
    seen.add(path);
    items.push({ key: `p:${p}`, path, image: false });
  }
  return items;
}

/**
 * 全会话产物清单：按轮序扫 turn-tail，跨轮按绝对路径去重。
 * 同一路径出现在多轮时保留最后一次（描述可被后续 present 修正），位置取首次出现处。
 */
export function sessionArtifacts(items: readonly RenderItem[], root?: string): ArtifactItem[] {
  const order: string[] = [];
  const byPath = new Map<string, ArtifactItem>();
  for (const item of items) {
    if (item.kind !== "turn-tail") continue;
    for (const merged of mergeArtifacts(item.produced ?? [], item.presented ?? [], root)) {
      if (!byPath.has(merged.path)) order.push(merged.path);
      byPath.set(merged.path, merged);
    }
  }
  return order.map((path) => byPath.get(path)!);
}
