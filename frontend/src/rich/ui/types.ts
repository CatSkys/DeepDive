// `ui` 围栏的组件词表（类型 + 形状校验，唯一事实源）：纯数据与纯函数，不含渲染。
// 词表契约全文见 docs/DUI-SPEC.md；部署提示词（壳侧 DeploymentPrompt.swift）教模型
// 的就是这里定义的形状——两处改动必须同步。
//
// 校验纪律：模型产出在边界处显式校验（铁律 5），字段超限/类型不符 = 该项无效，
// 闭合后整块退回代码块显示原文（与其他富输出围栏同一降级纪律）。这里不放兜底
// 默认值：合法降级只有「退回源码」一种。

/** 动作按钮：`send` 是点击后作为用户下一轮发出的**逐字文本**——所选值必须由模型
 *  显式嵌进这句话（快照语义，组件状态不回传）。 */
export interface UiButton {
  label: string;
  send: string;
}

export interface UiCard {
  type: "card";
  title?: string;
  /** 正文，Markdown 子集（经 Markdown 渲染链，不执行 HTML）。 */
  text?: string;
  /** 只保留调色板能表达的语义色（signal.warn）；accent 之类不进词表。 */
  tone?: "neutral" | "warn";
  actions?: UiButton[];
}

export interface UiActions {
  type: "actions";
  buttons: UiButton[];
}

export interface UiStat {
  type: "stat";
  label: string;
  value: string;
  hint?: string;
}

export type UiComponent = UiCard | UiActions | UiStat;

// 字段上限：挡住"把正文当文件塞"与失控按钮矩阵（围栏本身另有 200KB 总闸）。
const MAX_TITLE = 200;
const MAX_TEXT = 8_000;
const MAX_LABEL = 160;
const MAX_SEND = 2_000;
const MAX_VALUE = 120;
const MAX_HINT = 300;
const MAX_BUTTONS = 12;

function isStr(v: unknown, min: number, max: number): v is string {
  return typeof v === "string" && v.length >= min && v.length <= max;
}

function buttonOf(v: unknown): UiButton | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!isStr(o.label, 1, MAX_LABEL) || !isStr(o.send, 1, MAX_SEND)) return null;
  return { label: o.label, send: o.send };
}

function buttonsOf(v: unknown): UiButton[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_BUTTONS) return null;
  const out: UiButton[] = [];
  for (const b of v) {
    const btn = buttonOf(b);
    if (btn === null) return null;
    out.push(btn);
  }
  return out;
}

function cardOf(v: Record<string, unknown>): UiCard | null {
  const out: UiCard = { type: "card" };
  if (v.title !== undefined) {
    if (!isStr(v.title, 1, MAX_TITLE)) return null;
    out.title = v.title;
  }
  if (v.text !== undefined) {
    if (!isStr(v.text, 1, MAX_TEXT)) return null;
    out.text = v.text;
  }
  if (v.tone !== undefined) {
    if (v.tone !== "neutral" && v.tone !== "warn") return null;
    out.tone = v.tone;
  }
  if (v.actions !== undefined) {
    const buttons = buttonsOf(v.actions);
    if (buttons === null) return null;
    out.actions = buttons;
  }
  return out;
}

function actionsOf(v: Record<string, unknown>): UiActions | null {
  const buttons = buttonsOf(v.buttons);
  return buttons === null ? null : { type: "actions", buttons };
}

function statOf(v: Record<string, unknown>): UiStat | null {
  const raw = v.value;
  const value = typeof raw === "number" && Number.isFinite(raw) ? String(raw) : raw;
  if (!isStr(value, 1, MAX_VALUE) || !isStr(v.label, 1, MAX_LABEL)) return null;
  const out: UiStat = { type: "stat", label: v.label, value };
  if (v.hint !== undefined) {
    if (!isStr(v.hint, 1, MAX_HINT)) return null;
    out.hint = v.hint;
  }
  return out;
}

/** 单个已解析 JSON 对象 → 组件；形状不符返回 null（调用方决定降级）。 */
export function componentOf(v: unknown): UiComponent | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  switch (o.type) {
    case "card": return cardOf(o);
    case "actions": return actionsOf(o);
    case "stat": return statOf(o);
    default: return null;
  }
}
