import { useEffect, useState } from "react";
import css from "./FadeDebugPanel.module.css";
import {
  applyFadeValues, buildFadeCss, loadFadeValues, SLIDERS,
  type FadeDebugKey, type FadeDebugValues,
} from "./fadeDebug";

// 渐变模糊调试面板（?debug=fade 挂载，见 fadeDebug.ts）。滑杆改值 → 写
// :root 变量 + localStorage；复制 CSS 生成固化片段。
export function FadeDebugPanel({ onClose }: { onClose: () => void }) {
  const [values, setValues] = useState<FadeDebugValues>(loadFadeValues);
  const [copied, setCopied] = useState(false);

  useEffect(() => { applyFadeValues(loadFadeValues()); }, []); // 挂载即应用存档值（只此一次；拖动各自即时应用）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (key: FadeDebugKey, n: number) => {
    const next = { ...values, [key]: n };
    setValues(next);
    applyFadeValues(next);
    localStorage.setItem("deepdive.debug.fade", JSON.stringify(next));
  };

  const reset = () => {
    localStorage.removeItem("deepdive.debug.fade");
    const next = loadFadeValues();
    setValues(next);
    applyFadeValues(next);
  };

  const copy = () => {
    const text = buildFadeCss(values);
    void navigator.clipboard.writeText(text)
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
      {SLIDERS.map(({ key, label, min, max }) => (
        <label key={key} className={css.row}>
          <span className={css.label}>{label}</span>
          <input
            type="range"
            min={min}
            max={max}
            step={key.startsWith("--fade-m") ? 1 : 1}
            value={values[key]}
            onChange={(e) => set(key, Number(e.target.value))}
          />
          <span className={css.value}>{values[key]}{key.includes("-m") && /-m\d[a-b]$/.test(key) ? "%" : "px"}</span>
        </label>
      ))}
    </div>
  );
}
