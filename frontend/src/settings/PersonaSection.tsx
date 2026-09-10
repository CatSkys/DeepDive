// 自定义指令节（§6 persona）：system-prompt 插件 {personaPrefix, personaSuffix}
// 的用户入口——文本写 DSH_HOME/persona.json（壳桥 persona-get/set），壳启动时
// 经 engine-patch 的 id 级配置覆盖挂载；改后需重启引擎生效。

import { useEffect, useState } from "react";
import { personaGet, personaSet } from "../host";
import { t } from "../i18n";
import cssRows from "./SettingsRows.module.css";

export function PersonaSection() {
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void personaGet().then((p) => {
      if (!alive) return;
      setPrefix(p.prefix);
      setSuffix(p.suffix);
      setLoaded(true);
    }).catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  const save = () => {
    personaSet({ prefix, suffix });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className={cssRows.section}>
      <div className={cssRows.sectionTitle}>{t("自定义指令（Persona）")}</div>
      <div className={cssRows.sectionIntro}>
        {t("注入到每次对话系统提示词的前缀/后缀文本；留空则不注入。保存后需重启引擎生效。")}
      </div>
      {loaded && (
        <>
          <div className={cssRows.fieldGroup}>
            <div className={cssRows.fieldLabel}>{t("前缀（在常规提示词前注入）")}</div>
            <textarea
              className={cssRows.textField}
              rows={4}
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder={t("例如：回答保持简洁，优先给结论。")}
            />
          </div>
          <div className={cssRows.fieldGroup}>
            <div className={cssRows.fieldLabel}>{t("后缀（在常规提示词后注入）")}</div>
            <textarea
              className={cssRows.textField}
              rows={4}
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
              placeholder={t("例如：所有回答使用中文。")}
            />
          </div>
          <button type="button" className={cssRows.textBtn} onClick={save}>{t("保存")}</button>
          {saved && <span role="status">{t("已保存——重启引擎后生效。")}</span>}
        </>
      )}
    </div>
  );
}
