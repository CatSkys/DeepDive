// 统计页分段控件（每日/每周/累计 · 近 7 日/近 30 日）：热力图与趋势图共用一份
// （样式在 UsageSection.module.css，激活项 ink 实底）。文案经词典。

import { useT } from "../i18n";
import css from "./UsageSection.module.css";

export function Seg<T extends string | number>({ value, options, onChange }: {
  value: T;
  options: ReadonlyArray<{ v: T; label: string }>;
  onChange: (v: T) => void;
}) {
  const { t } = useT();
  return (
    <div className={css.seg}>
      {options.map((o) => (
        <button
          key={String(o.v)}
          className={`${css.segItem}${o.v === value ? ` ${css.active}` : ""}`}
          onClick={() => onChange(o.v)}
        >
          {t(o.label)}
        </button>
      ))}
    </div>
  );
}
