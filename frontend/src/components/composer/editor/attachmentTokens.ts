// 附件在编辑器文档里的形态（照 Atd 的 chip-state）：一枚**私有区哨兵包起来的令牌**
// `\uE000<id>\uE001`，令牌 id → 附件 id 的表放在状态字段里。好处有三条：
//   · 复制/撤销/重做只搬文本，令牌跟着走，不需要额外的同步；
//   · 私有区字符打不出来、粘贴进来也会被过滤（inputFilters），所以文档里出现的一定是我们
//     自己插的，不会被用户手打的字冒充；
//   · 表只增不删——撤销把令牌救回来时它还能查出是哪颗附件（见 tokenTable 的注释）。
// 文档文本仍按原样存（令牌就嵌在正文里），**纯文本读法**（给菜单/草稿/发送裁决看的那份）
// 与**载荷分段**（附件与正文按文档序交错）都由这里换算，别处不许自己 slice 字符串。
import { StateEffect, StateField } from "@codemirror/state";

const OPEN = "\uE000";
const CLOSE = "\uE001";
const TOKEN = /\uE000([0-9a-z]+)\uE001/g;
/** 正文里不该出现的哨兵（粘贴进来的原件整段剥掉，见 inputFilters）。 */
export const SENTINELS = /[\uE000\uE001]/g;

/** 一枚令牌：文档里的 id ↔ 它代表的附件。 */
export interface TokenEntry {
  id: string;
  attachmentId: string;
}

let lastId = 0;

/** 给一颗附件发一枚令牌（id 在渲染器生命周期内唯一；草稿不持久化令牌）。 */
export function tokenEntry(attachmentId: string): TokenEntry {
  lastId += 1;
  return { id: lastId.toString(36), attachmentId };
}

export function tokenOf(id: string): string {
  return `${OPEN}${id}${CLOSE}`;
}

export const addTokens = StateEffect.define<readonly TokenEntry[]>();

/** 令牌 id → 附件 id。**条目只增不删**：撤销能把删掉的令牌救回来，那时表里还得有它。 */
export const tokenTable = StateField.define<ReadonlyMap<string, string>>({
  create: () => new Map(),
  update(table, transaction) {
    let next = table;
    for (const effect of transaction.effects) {
      if (!effect.is(addTokens)) continue;
      const added = new Map(next);
      for (const { id, attachmentId } of effect.value) added.set(id, attachmentId);
      next = added;
    }
    return next;
  },
});

/** 文档里的每一枚已知令牌（文档序）。 */
export function* tokensIn(text: string, table: ReadonlyMap<string, string>) {
  for (const match of text.matchAll(TOKEN)) {
    const id = match[1] ?? "";
    const attachmentId = table.get(id);
    if (attachmentId !== undefined) yield { from: match.index, to: match.index + match[0].length, attachmentId };
  }
}

/** 文档分段（文档序）：文本段与附件段交替——发送载荷与"哪些附件还在正文里"都读它。 */
export type DocSegment = string | { attachmentId: string };

export function segmentsOf(text: string, table: ReadonlyMap<string, string>): DocSegment[] {
  const segments: DocSegment[] = [];
  let at = 0;
  for (const { from, to, attachmentId } of tokensIn(text, table)) {
    if (from > at) segments.push(strip(text.slice(at, from)));
    segments.push({ attachmentId });
    at = to;
  }
  if (at < text.length) segments.push(strip(text.slice(at)));
  return segments;
}

/** 纯文本：令牌整段丢掉、游离哨兵也剥掉（菜单/草稿/斜杠裁决读的那一份）。 */
export function plainOf(text: string, table: ReadonlyMap<string, string>): string {
  return segmentsOf(text, table).filter((s): s is string => typeof s === "string").join("");
}

function strip(text: string): string {
  return text.replace(SENTINELS, "");
}

/** 纯文本坐标 → 文档坐标：纯文本是"令牌整段删掉"的样子，所以把目标前面那些令牌的
 *  长度补回去。菜单按纯文本给的插入点，写进文档前都要过这里。 */
export function docOffset(plainOffset: number, text: string, table: ReadonlyMap<string, string>): number {
  let shift = 0;
  for (const { from, to } of tokensIn(text, table)) {
    if (plainOffset + shift <= from) break;
    shift += to - from;
  }
  return Math.min(plainOffset + shift, text.length);
}

/** 文档坐标 → 纯文本坐标：光标位要喂给 `@` 语法（它按纯文本算），所以要换算回来。
 *  落在令牌内部（理论上不会：原子范围让光标跨过去）时算在令牌**前面**。 */
export function plainOffset(docPos: number, text: string, table: ReadonlyMap<string, string>): number {
  let plain = 0;
  let doc = 0;
  for (const { from, to } of tokensIn(text, table)) {
    if (docPos <= from) break;
    plain += from - doc;
    doc = to;
    if (docPos < to) return plain;
  }
  return plain + (Math.max(docPos, doc) - doc);
}

/** 分段 → 文档文本 + 要登记的令牌（建新状态时用）。 */
export function documentOf(segments: readonly DocSegment[]): { doc: string; entries: TokenEntry[] } {
  let doc = "";
  const entries: TokenEntry[] = [];
  for (const segment of segments) {
    if (typeof segment === "string") {
      doc += strip(segment);
      continue;
    }
    const entry = tokenEntry(segment.attachmentId);
    entries.push(entry);
    doc += tokenOf(entry.id);
  }
  return { doc, entries };
}
