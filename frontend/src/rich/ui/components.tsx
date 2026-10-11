// `ui` 围栏组件的渲染注册表。只管把已校验的组件数据画出来，不管解析
// （parse.ts）与围栏壳（UiBlock.tsx）；表单（有状态）在 form.tsx，图表
// （自绘 SVG）在 chart.tsx。
//
// 流内样式纪律（PITFALLS §1.14）：`.flow/.md *` 的 background 会被全局
// !important 清掉——卡片只有描边，动作按钮一律「描边 + 亮字」，不写实底。
import type { CSSProperties } from "react";
import { Markdown } from "../../components/Markdown";
import type { UiButton, UiCard, UiComponent, UiCompare, UiStat, UiTable, UiSteps } from "./types";
import { FormView } from "./form";
import { ChartView } from "./chart";

function UiButtons({ buttons, onSend }: { buttons: UiButton[]; onSend?: (text: string) => void }) {
  return (
    <div className="md-ui-actions">
      {buttons.map((b, i) => (
        <button key={i} type="button" className="md-ui-btn" onClick={() => onSend?.(b.send)}>
          {b.label}
        </button>
      ))}
    </div>
  );
}

function CardView({ item, onSend }: { item: UiCard; onSend?: (text: string) => void }) {
  return (
    <div className="md-ui-card" data-tone={item.tone ?? "neutral"}>
      {item.title && <div className="md-ui-card-title">{item.title}</div>}
      {item.text && <div className="md-ui-card-text"><Markdown text={item.text} /></div>}
      {item.actions && <UiButtons buttons={item.actions} onSend={onSend} />}
    </div>
  );
}

function StatView({ item }: { item: UiStat }) {
  return (
    <div className="md-ui-stat">
      <span className="md-ui-stat-value">{item.value}</span>
      <span className="md-ui-stat-label">{item.label}</span>
      {item.hint && <span className="md-ui-stat-hint">{item.hint}</span>}
    </div>
  );
}

function TableView({ item }: { item: UiTable }) {
  return (
    <div className="md-ui-tablewrap">
      <table className="md-ui-table">
        <thead>
          <tr>{item.columns.map((c, j) => <th key={j}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {item.rows.map((row, i) => (
            <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompareView({ item }: { item: UiCompare }) {
  return (
    <div className="md-ui-compare">
      {item.title && <div className="md-ui-card-title">{item.title}</div>}
      <div className="md-ui-compare-cols" style={{ "--cols": item.options.length } as CSSProperties}>
        {item.options.map((opt, i) => (
          <div key={i} className="md-ui-compare-col">
            <div className="md-ui-compare-head">{opt.title}</div>
            <ul>{opt.points.map((p, j) => <li key={j}>{p}</li>)}</ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepsView({ item }: { item: UiSteps }) {
  return (
    <ol className="md-ui-steps">
      {item.items.map((step, i) => {
        const state = item.active === undefined ? "idle" : i < item.active ? "done" : i === item.active ? "active" : "idle";
        return (
          <li key={i} data-state={state}>
            <span className="md-ui-step-dot" aria-hidden="true">{state === "done" ? "✓" : i + 1}</span>
            <span className="md-ui-step-body">
              <span className="md-ui-step-title">{step.title}</span>
              {step.text && <span className="md-ui-step-text">{step.text}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** 单个组件 → 元素（key 由 UiBlock 按位置给）。 */
export function UiComponentView({ item, onSend }: { item: UiComponent; onSend?: (text: string) => void }) {
  switch (item.type) {
    case "card": return <CardView item={item} onSend={onSend} />;
    case "actions": return <UiButtons buttons={item.buttons} onSend={onSend} />;
    case "stat": return <StatView item={item} />;
    case "table": return <TableView item={item} />;
    case "compare": return <CompareView item={item} />;
    case "form": return <FormView item={item} onSend={onSend} />;
    case "steps": return <StepsView item={item} />;
    case "chart": return <ChartView item={item} />;
    default: return null; // 词表校验（componentOf）保证到不了：穷尽性兜底
  }
}
