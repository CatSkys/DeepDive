// DeepDiving 的暂停/结束盖层（DeepDiving.tsx 拆出）：只管这两个状态的呈现与按钮。
// onMouseDown 全部 preventDefault——按钮不许抢面板焦点，否则空格会双触发（推力+点击）。
import type { MouseEvent as ReactMouseEvent } from "react";
import { t, tt } from "../i18n";
import css from "./DeepDiving.module.css";

const noFocusSteal = (e: ReactMouseEvent) => e.preventDefault();

export function PausedOverlay({ onResume, onClose }: {
  onResume: () => void;
  onClose: () => void;
}) {
  return (
    <div className={css.ov}>
      <div className={css.ovTitle}>{t("已暂停")}</div>
      <div className={css.ovRow}>
        <button type="button" className={css.ovBtn} onMouseDown={noFocusSteal} onClick={onResume}>
          {t("继续")}
        </button>
        <button type="button" className={css.ovBtn} onMouseDown={noFocusSteal} onClick={onClose}>
          {t("关闭")}
        </button>
      </div>
    </div>
  );
}

export function DeadOverlay({ meters, best, onRetry, onClose }: {
  meters: number;
  best: number;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className={css.ov}>
      <div className={css.ovDepth}>{meters}m</div>
      <div className={css.ovBest}>{tt("最佳 {m} 米", "Best {m} m", { m: best })}</div>
      <div className={css.ovRow}>
        <button type="button" className={css.ovBtn} onMouseDown={noFocusSteal} onClick={onRetry}>
          {t("再来")}
        </button>
        <button type="button" className={css.ovBtn} onMouseDown={noFocusSteal} onClick={onClose}>
          {t("关闭")}
        </button>
      </div>
    </div>
  );
}
