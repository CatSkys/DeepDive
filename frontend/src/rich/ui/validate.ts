// `ui` 词表的形状校验（唯一实现，契约全文见 docs/DUI-SPEC.md）：把模型产出的
// unknown 收敛成 ./types 里的类型，`componentOf` 是唯一入口。
//
// 校验纪律：模型产出在边界处显式校验（铁律 5），字段超限/类型不符 = 该项无效，
// 闭合后整块退回代码块显示原文（与其他富输出围栏同一降级纪律）。这里不放兜底
// 默认值：合法降级只有「退回源码」一种。
import type {
  UiActions,
  UiButton,
  UiCard,
  UiChart,
  UiChartSeries,
  UiCompare,
  UiComponent,
  UiForm,
  UiFormField,
  UiStat,
  UiSteps,
  UiTable,
} from "./types";

// 字段上限：挡住"把正文当文件塞"与失控按钮矩阵（围栏本身另有 200KB 总闸）。
const MAX_TITLE = 200;
const MAX_TEXT = 8_000;
const MAX_LABEL = 160;
const MAX_SEND = 2_000;
const MAX_VALUE = 120;
const MAX_HINT = 300;
const MAX_BUTTONS = 12;
// M2 词表的上限：表格/对比/步骤是排版件，表单是受控输入，图表是自绘 SVG。
const MAX_COLUMNS = 8;
const MAX_ROWS = 200;
const MAX_CELL = 400;
const MAX_POINTS = 8;
const MAX_POINT = 300;
const MAX_OPTIONS = 4;
const MAX_FIELDS = 8;
const MAX_STEPS = 12;
const MAX_SERIES = 4;
const MAX_LABELS = 24;
const FIELD_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/;

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

function cellOf(v: unknown): string | null {
  const s = typeof v === "number" && Number.isFinite(v) ? String(v) : v;
  return isStr(s, 0, MAX_CELL) ? s : null;
}

function tableOf(v: Record<string, unknown>): UiTable | null {
  if (!Array.isArray(v.columns) || v.columns.length < 1 || v.columns.length > MAX_COLUMNS) return null;
  const columns: string[] = [];
  for (const c of v.columns) {
    if (!isStr(c, 1, MAX_LABEL)) return null;
    columns.push(c);
  }
  if (!Array.isArray(v.rows) || v.rows.length > MAX_ROWS) return null;
  const rows: (string | number)[][] = [];
  for (const row of v.rows) {
    if (!Array.isArray(row) || row.length !== columns.length) return null;
    const cells: string[] = [];
    for (const cell of row) {
      const s = cellOf(cell);
      if (s === null) return null;
      cells.push(s);
    }
    rows.push(cells);
  }
  return { type: "table", columns, rows };
}

function compareOf(v: Record<string, unknown>): UiCompare | null {
  if (!Array.isArray(v.options) || v.options.length < 2 || v.options.length > MAX_OPTIONS) return null;
  const out: UiCompare = { type: "compare", options: [] };
  if (v.title !== undefined) {
    if (!isStr(v.title, 1, MAX_TITLE)) return null;
    out.title = v.title;
  }
  for (const raw of v.options) {
    if (typeof raw !== "object" || raw === null) return null;
    const o = raw as Record<string, unknown>;
    if (!isStr(o.title, 1, MAX_LABEL) || !Array.isArray(o.points) || o.points.length < 1 || o.points.length > MAX_POINTS) return null;
    const points: string[] = [];
    for (const p of o.points) {
      if (!isStr(p, 1, MAX_POINT)) return null;
      points.push(p);
    }
    out.options.push({ title: o.title, points });
  }
  return out;
}

function fieldOf(v: unknown): UiFormField | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== "string" || !FIELD_NAME.test(o.name) || !isStr(o.label, 1, MAX_LABEL)) return null;
  if (o.type !== "text" && o.type !== "number" && o.type !== "select" && o.type !== "slider") return null;
  const field: UiFormField = { name: o.name, label: o.label, type: o.type };
  if (o.placeholder !== undefined) {
    if (!isStr(o.placeholder, 1, MAX_LABEL)) return null;
    field.placeholder = o.placeholder;
  }
  for (const key of ["min", "max", "step"] as const) {
    if (o[key] !== undefined) {
      if (typeof o[key] !== "number" || !Number.isFinite(o[key])) return null;
      field[key] = o[key];
    }
  }
  if (o.options !== undefined) {
    if (!Array.isArray(o.options) || o.options.length < 1 || o.options.length > MAX_BUTTONS) return null;
    const options: string[] = [];
    for (const opt of o.options) {
      if (!isStr(opt, 1, MAX_LABEL)) return null;
      options.push(opt);
    }
    field.options = options;
  }
  if (o.value !== undefined) {
    const value = typeof o.value === "number" && Number.isFinite(o.value) ? String(o.value) : o.value;
    if (!isStr(value, 0, MAX_VALUE)) return null;
    field.value = value;
  }
  if (field.type === "select" && field.options === undefined) return null;
  return field;
}

function formOf(v: Record<string, unknown>): UiForm | null {
  if (!Array.isArray(v.fields) || v.fields.length < 1 || v.fields.length > MAX_FIELDS) return null;
  const fields: UiFormField[] = [];
  const seen = new Set<string>();
  for (const raw of v.fields) {
    const field = fieldOf(raw);
    if (field === null || seen.has(field.name)) return null;
    seen.add(field.name);
    fields.push(field);
  }
  if (typeof v.submit !== "object" || v.submit === null) return null;
  const submit = v.submit as Record<string, unknown>;
  if (!isStr(submit.label, 1, MAX_LABEL) || !isStr(submit.send, 1, MAX_SEND)) return null;
  const out: UiForm = { type: "form", fields, submit: { label: submit.label, send: submit.send } };
  if (v.title !== undefined) {
    if (!isStr(v.title, 1, MAX_TITLE)) return null;
    out.title = v.title;
  }
  return out;
}

function stepsOf(v: Record<string, unknown>): UiSteps | null {
  if (!Array.isArray(v.items) || v.items.length < 1 || v.items.length > MAX_STEPS) return null;
  const items: UiSteps["items"] = [];
  for (const raw of v.items) {
    if (typeof raw !== "object" || raw === null) return null;
    const o = raw as Record<string, unknown>;
    if (!isStr(o.title, 1, MAX_LABEL)) return null;
    const item: UiSteps["items"][number] = { title: o.title };
    if (o.text !== undefined) {
      if (!isStr(o.text, 1, MAX_POINT)) return null;
      item.text = o.text;
    }
    items.push(item);
  }
  const out: UiSteps = { type: "steps", items };
  if (v.active !== undefined) {
    if (typeof v.active !== "number" || !Number.isInteger(v.active) || v.active < 0 || v.active >= items.length) return null;
    out.active = v.active;
  }
  return out;
}

function chartOf(v: Record<string, unknown>): UiChart | null {
  if (v.chart !== "bar" && v.chart !== "line" && v.chart !== "pie") return null;
  if (!Array.isArray(v.labels) || v.labels.length < 1 || v.labels.length > MAX_LABELS) return null;
  const labels: string[] = [];
  for (const l of v.labels) {
    if (!isStr(l, 1, MAX_LABEL)) return null;
    labels.push(l);
  }
  if (!Array.isArray(v.series) || v.series.length < 1 || v.series.length > MAX_SERIES) return null;
  const series: UiChartSeries[] = [];
  for (const raw of v.series) {
    if (typeof raw !== "object" || raw === null) return null;
    const o = raw as Record<string, unknown>;
    if (!Array.isArray(o.values) || o.values.length !== labels.length) return null;
    const values: number[] = [];
    for (const n of o.values) {
      if (typeof n !== "number" || !Number.isFinite(n)) return null;
      values.push(n);
    }
    const item: UiChartSeries = { values };
    if (o.name !== undefined) {
      if (!isStr(o.name, 1, MAX_LABEL)) return null;
      item.name = o.name;
    }
    series.push(item);
  }
  const out: UiChart = { type: "chart", chart: v.chart, labels, series };
  if (v.title !== undefined) {
    if (!isStr(v.title, 1, MAX_TITLE)) return null;
    out.title = v.title;
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
    case "table": return tableOf(o);
    case "compare": return compareOf(o);
    case "form": return formOf(o);
    case "steps": return stepsOf(o);
    case "chart": return chartOf(o);
    default: return null;
  }
}
