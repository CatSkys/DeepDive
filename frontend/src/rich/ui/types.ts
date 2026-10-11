// `ui` 围栏的组件词表（类型，唯一事实源）：形状校验在 ./validate（`componentOf`
// 是唯一入口），纯类型不含渲染。词表契约全文见 docs/DUI-SPEC.md；部署提示词
//（壳侧 DeploymentPrompt.swift）教模型的就是这里定义的形状——两处改动必须同步。

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

export interface UiTable {
  type: "table";
  columns: string[];
  /** 行内单元格允许数字（模型对账类输出常见）；渲染时统一 String()。 */
  rows: (string | number)[][];
}

export interface UiCompare {
  type: "compare";
  title?: string;
  options: { title: string; points: string[] }[];
}

export interface UiFormField {
  /** 表单名只作 send 模板的 {{name}} 占位与受控键，不进入渲染。 */
  name: string;
  label: string;
  type: "text" | "number" | "select" | "slider";
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  value?: string | number;
}

export interface UiForm {
  type: "form";
  title?: string;
  fields: UiFormField[];
  /** 提交模板：{{name}} 占位按当前值替换后作为用户下一轮发出。 */
  submit: { label: string; send: string };
}

export interface UiSteps {
  type: "steps";
  items: { title: string; text?: string }[];
  active?: number;
}

export interface UiChartSeries {
  name?: string;
  values: number[];
}

export interface UiChart {
  type: "chart";
  chart: "bar" | "line" | "pie";
  title?: string;
  labels: string[];
  series: UiChartSeries[];
}

export type UiComponent =
  | UiCard | UiActions | UiStat | UiTable | UiCompare | UiForm | UiSteps | UiChart;
