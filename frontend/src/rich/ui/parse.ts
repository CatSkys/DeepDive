// `ui` 围栏的流式容错解析（纯函数，不含渲染）：围栏体是 JSON 数组，每项一个组件。
//
// 流式语义（PITFALLS §3.7 的"未闭合 ≠ 渲染失败"在这里的落法）：
//   · 围栏未闭合时，已完整闭合的项逐个解析渲染——组件随生成逐个出现，不等整条回复；
//   · 最后一项与尾部碎片是 pending：能解析且形状合规就提前上屏，否则只挂占位，
//     **绝不判失败**（流式期间最后一项随时可能继续长）；
//   · 围栏闭合后严格：任何一项解析失败/形状不符、数组没闭合、`]` 后还有残渣 →
//     整块 invalid，由块组件退回代码块显示原文。
import { componentOf } from "./validate";
import type { UiComponent } from "./types";

export interface UiParseResult {
  items: UiComponent[];
  /** 结构还没长全（围栏未闭合且数组未闭合）：块组件据此挂"生成中"占位。 */
  pending: boolean;
  /** 闭合后仍有解析失败/形状不符：整块退回源码。 */
  invalid: boolean;
}

export function parseUiFence(body: string, unclosed: boolean): UiParseResult {
  const text = body.trim();
  // 单对象容错（2026-10-11 验收实测：模型教了"JSON 数组"仍常直接发一个组件对象）：
  // `{…}` 也算合法形态——闭合后整对象解析校验，未闭合时按暂定项处理（合规就提前
  // 上屏，不合规只挂占位）。
  if (text.startsWith("{")) {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      // 未闭合 = 还在长（可能继续到能解析）；闭合后还解不动 = 残渣，退回源码。
      return { items: [], pending: unclosed, invalid: !unclosed };
    }
    const component = componentOf(value);
    if (component === null) {
      return { items: [], pending: unclosed, invalid: !unclosed };
    }
    return { items: [component], pending: false, invalid: false };
  }
  if (!text.startsWith("[")) {
    // `[` 还没到（或前面有模型废话）：未闭合继续等，闭合后按原文退回。
    return { items: [], pending: unclosed, invalid: !unclosed };
  }

  // 一遍扫描找顶层对象 span：字符串感知的深度计数。`[` 使 depth=1；depth 1 上遇到
  // `{` 开一个顶层对象、配对 `}` 收一个 span；`]` 回到 0 即数组闭合。
  const spans: string[] = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let objStart = -1;
  let arrayClosed = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{" || ch === "[") {
      if (depth === 1 && ch === "{" && objStart < 0) objStart = i;
      depth++;
      continue;
    }
    if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        if (ch === "]" && objStart < 0) { arrayClosed = true; break; }
        break; // 数组在中途被 } 或越界闭合：结构残缺，交给下方的严格判定
      }
      if (depth === 1 && ch === "}" && objStart >= 0) {
        spans.push(text.slice(objStart, i + 1));
        objStart = -1;
      }
    }
  }

  // 数组还没闭合（流式中）或数组已闭合但 `]` 之后还有非空白内容（闭合后）：
  // 前者是常态 pending，后者按残渣处理。
  const end = arrayClosed ? text.lastIndexOf("]") + 1 : text.length;
  const trailing = text.slice(end).trim();
  const pending = unclosed && !arrayClosed;
  if (!unclosed && (!arrayClosed || trailing !== "")) {
    return { items: [], pending: false, invalid: true };
  }

  // 逐 span 解析：除"未闭合时的最后一项"都是已定格内容——失败即整块降级；
  // 最后一项在 pending 期间是暂定态：合规就提前渲染，不合规只挂占位不判失败。
  const items: UiComponent[] = [];
  for (let k = 0; k < spans.length; k++) {
    const last = pending && k === spans.length - 1;
    let value: unknown;
    try {
      value = JSON.parse(spans[k]);
    } catch {
      if (last) continue;
      return { items: [], pending: false, invalid: true };
    }
    const component = componentOf(value);
    if (component === null) {
      if (last) continue;
      return { items: [], pending: false, invalid: true };
    }
    items.push(component);
  }
  return { items, pending, invalid: false };
}
