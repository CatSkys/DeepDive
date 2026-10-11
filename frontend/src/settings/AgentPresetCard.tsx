// 通用设置里的「默认会话模式」卡片：新会话用哪个 agent preset。
// 读写通道在 useAgentPresetDefault（边栏会话设置同一份）；这里只管卡片形态。

import { useT } from "../i18n";
import { Dropdown } from "../components/controls";
import css from "./SettingsRows.module.css";
import { useAgentPresetDefault } from "./useAgentPresetDefault";

export function AgentPresetCard() {
  const { t } = useT();
  const { current, options, save } = useAgentPresetDefault();
  if (current === null || options.length === 0) return null;

  return (
    <div className={css.rowCard}>
      <div className={css.rowIdentity}>
        <div className={css.rowName}>{t("默认会话模式")}</div>
        <div className={css.rowCaption}>{t("新建会话时使用；运行中的会话保持开始时的模式。")}</div>
      </div>
      <div className={css.rowActions}>
        <Dropdown options={options} value={current} onChange={(v) => void save(v)} />
      </div>
    </div>
  );
}
