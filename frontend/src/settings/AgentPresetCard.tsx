// 通用设置里的「默认会话模式」卡片：新会话用哪个 agent preset。
//
// 事实源是引擎 `agent-presets` 设置命名空间的 `default` 键（schema 只有这一个键，
// 组合里的 base 是 standard）；会话创建时按它 pin，跑过一轮即锁死（引擎
// agent-preset/locked），所以这里改的是"以后新建的会话"。可选项来自
// agentPresets/list 名录经 agentPreset.ts 过滤——命名空间 schema 是纯 string，
// 给不出枚举。命名空间缺失或名录里没有开放的模式时整张卡不渲染（引擎降级）。

import { useCallback, useEffect, useState } from "react";
import { Dropdown } from "../components/controls";
import { alertDialog } from "../components/DialogHost";
import { useT } from "../i18n";
import { useStore } from "../store";
import css from "./SettingsRows.module.css";
import { agentPresetLabel, visibleAgentPresets } from "./agentPreset";
import { SettingsConflictError, useSettingNamespace } from "./useSettingNamespace";

export function AgentPresetCard() {
  const { t, tt } = useT();
  const { presets } = useStore();
  const [current, setCurrent] = useState<string | null>(null);
  const { describe, update } = useSettingNamespace("agent-presets");

  const load = useCallback(async () => {
    try {
      const v = ((await describe())?.value as { default?: unknown } | null)?.default;
      setCurrent(typeof v === "string" ? v : null);
    } catch { /* engine booting: stay hidden */ }
  }, [describe]);
  useEffect(() => { void load(); }, [load]);

  const options = visibleAgentPresets(presets).map((p) => ({ v: p.id, label: agentPresetLabel(p) }));
  if (current === null || options.length === 0) return null;

  const save = async (v: string) => {
    setCurrent(v);
    try {
      await update({ default: v });
    } catch (err) {
      void alertDialog(err instanceof SettingsConflictError
        ? { message: t("版本已前进——请取消后重新打开(将载入最新)") }
        : { message: tt("保存失败：{m}", "Save failed: {m}", { m: (err as Error).message }) });
    }
    await load();
  };

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
