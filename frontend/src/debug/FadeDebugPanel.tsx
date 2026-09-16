import { useEffect, useState } from "react";
import css from "./FadeDebugPanel.module.css";
import {
  FADE_KNOBS, applyFadeValues, buildFadeCss, loadFadeValues, resetFadeValues, saveFadeValues,
  type FadeValues,
} from "./fadeDebug";

// 渐变模糊调试面板（⌥⌘D 切、?debug=fade 挂载，见 fadeDebug.ts）。滑杆改值 → 写
// :root 变量 + 存档；「恢复默认」摘掉覆盖回 theme.css 的默认值，「复制 CSS」生成
// 固化片段。每根旋钮都标了它改什么——不留看不清作用的黑箱旋钮。
export function FadeDebugPanel({ onClose }: { onClose: () => void }) {
  const [values, setValues] = useState<FadeValues>(loadFadeValues);
  const [copied, setCopied] = useState(false);

  useEffect(() => { applyFadeValues(loadFadeValues()); }, []); // 挂载即应用存档值（只此一次；拖动各自即时应用）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (key: string, n: number) => {
    const next = { ...values, [key]: n };
    setValues(next);
    applyFadeValues(next);
    saveFadeValues(next);
  };

  const reset = () => setValues(resetFadeValues());

  const copy = () => {
    void navigator.clipboard.writeText(buildFadeCss(values))
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={css.panel} role="dialog" aria-label="渐变模糊调试">
      <div className={css.head}>
        <span>渐变模糊调试</span>
        <span className={css.headActions}>
          <button className={css.btn} onClick={reset}>恢复默认</button>
          <button className={css.btn} onClick={copy}>{copied ? "已复制" : "复制 CSS"}</button>
          <button className={css.btn} onClick={onClose}>关闭</button>
        </span>
      </div>
      <p className={css.hint}>拖动实时生效；「复制 CSS」粘回 theme.css 的 :root 即固化。</p>
      {FADE_KNOBS.map(({ key, label, min, max, unit, hint }) => (
        <div key={key} className={css.knob}>
          <label className={css.row}>
            <span className={css.label}>{label}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={1}
              value={values[key]}
              onChange={(e) => set(key, Number(e.target.value))}
            />
            <span className={css.value}>{values[key]}{unit}</span>
          </label>
          <span className={css.sub}>{hint}</span>
        </div>
      ))}
    </div>
  );
}
