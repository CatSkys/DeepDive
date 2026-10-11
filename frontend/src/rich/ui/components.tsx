// `ui` 围栏组件的渲染注册表（M1：card / actions / stat）。只管把已校验的
// 组件数据画出来，不管解析（parse.ts）与围栏壳（UiBlock.tsx）。
//
// 流内样式纪律（PITFALLS §1.14）：`.flow/.md *` 的 background 会被全局
// !important 清掉——卡片只有描边，动作按钮一律「描边 + 亮字」，不写实底。
import { Markdown } from "../../components/Markdown";
import type { UiButton, UiCard, UiComponent, UiStat } from "./types";

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

/** 单个组件 → 元素（key 由 UiBlock 按位置给）。 */
export function UiComponentView({ item, onSend }: { item: UiComponent; onSend?: (text: string) => void }) {
  switch (item.type) {
    case "card": return <CardView item={item} onSend={onSend} />;
    case "actions": return <UiButtons buttons={item.buttons} onSend={onSend} />;
    case "stat": return <StatView item={item} />;
  }
}
