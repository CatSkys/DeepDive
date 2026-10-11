// `ui` 围栏的表单组件（词表里唯一有状态的渲染件）：受控输入 + 提交模板。
// 提交时把每个字段的当前值替换进 send 模板的 {{name}} 占位，合成一句话交给
// onSend——与会话页/悬浮卡动作按钮同一条发送路径（useSessionSend）。值只经
// 文本出站（快照语义），没有别的回传通道。
import { useState } from "react";
import type { UiForm, UiFormField } from "./types";

/** send 模板填充：只替换词表校验过的字段名占位；没出现的字段不参与。 */
export function fillTemplate(send: string, values: Record<string, string>): string {
  let out = send;
  for (const [name, value] of Object.entries(values)) {
    out = out.split(`{{${name}}}`).join(value);
  }
  return out;
}

function FieldView({ field, value, onChange }: {
  field: UiFormField;
  value: string;
  onChange: (v: string) => void;
}) {
  const label = <label className="md-ui-field-label">{field.label}</label>;
  if (field.type === "select") {
    return (
      <div className="md-ui-field">
        {label}
        <select value={value} onChange={(e) => onChange(e.currentTarget.value)}>
          {(field.options ?? []).map((opt, i) => <option key={i} value={opt}>{opt}</option>)}
        </select>
      </div>
    );
  }
  if (field.type === "slider") {
    return (
      <div className="md-ui-field md-ui-field-slider">
        {label}
        <div className="md-ui-field-slider-row">
          <input
            type="range"
            min={field.min}
            max={field.max}
            step={field.step}
            value={value}
            onChange={(e) => onChange(e.currentTarget.value)}
          />
          <span className="md-ui-field-value">{value}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="md-ui-field">
      {label}
      <input
        type={field.type === "number" ? "number" : "text"}
        min={field.min}
        max={field.max}
        step={field.step}
        placeholder={field.placeholder}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </div>
  );
}

export function FormView({ item, onSend }: { item: UiForm; onSend?: (text: string) => void }) {
  // 初值：模型给的字段 value；缺省空串（select 落首项由 value="" 语义兜为第一项）。
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(item.fields.map((f) => [f.name, f.value === undefined ? "" : String(f.value)])),
  );
  const submit = () => {
    const text = fillTemplate(item.submit.send, values);
    if (text.trim() !== "") onSend?.(text);
  };
  return (
    <div className="md-ui-card md-ui-form">
      {item.title && <div className="md-ui-card-title">{item.title}</div>}
      {item.fields.map((field) => (
        <FieldView
          key={field.name}
          field={field}
          value={values[field.name] ?? ""}
          onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
        />
      ))}
      <div className="md-ui-actions">
        <button type="button" className="md-ui-btn" onClick={submit}>{item.submit.label}</button>
      </div>
    </div>
  );
}
