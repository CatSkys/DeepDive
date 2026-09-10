// 轮内过程折叠披露条（官方 TurnProcessNodeView 移植）：整行可点，
// aria-expanded 表示过程是否展开。样式走 theme.css .turn-process-row。
import { ChevronDown } from "lucide-react";
import { t, tt } from "../i18n";
import { turnProcessLabel, type TurnProcessInfo } from "./turnProcess";

export function TurnProcessBar({ info, open, onToggle }: {
  info: TurnProcessInfo;
  open: boolean;
  onToggle: () => void;
}) {
  const label = turnProcessLabel(info, tt);
  return (
    <button
      type="button"
      className="turn-process-row"
      data-open={open || undefined}
      aria-expanded={open}
      aria-label={open ? t("收起过程") : t("展开过程")}
      onClick={onToggle}
    >
      <span className="turn-process-label">{label}</span>
      <ChevronDown size={14} className="turn-process-chevron" />
    </button>
  );
}
