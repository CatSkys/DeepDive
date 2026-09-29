// 统计页分段控件（每日/每周/累计 · 近 7 日/近 30 日）：热力图与趋势图共用一份
// （样式在 UsageSection.module.css，激活项 ink 实底）。文案经词典。

import { useT } from "../i18n";
import { useSelectionGlide } from "../components/useSelectionGlide";
import css from "./UsageSection.module.css";

export function Seg<T extends string | number>({ value, options, onChange }: {
  value: T;
  options: ReadonlyArray<{ v: T; label: string }>;
  onChange: (v: T) => void;
}) {
  const { t } = useT();
  const glide = useSelectionGlide<HTMLDivElement>(`.${css.segItem}[data-sel]`);
  return (
    <div className={css.seg} ref={glide.setContainer}>
      {glide.box && <div className="sel-glide glide-seg" style={glide.glideStyle} />}
      {options.map((o) => (
        <button
          key={String(o.v)}
          className={`${css.segItem}${o.v === value ? ` ${css.active}` : ""}`}
          {...(o.v === value ? { "data-sel": "" } : {})}
          onClick={() => onChange(o.v)}
        >
          {t(o.label)}
        </button>
      ))}
    </div>
  );
}
