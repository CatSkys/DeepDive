// 「默认会话模式」的共享读写通道：引擎 `agent-presets` 设置命名空间的 `default`
// 键（会话创建时按它 pin，跑过一轮即锁死——引擎 agent-preset/locked，所以改的
// 是"以后新建的会话"）。设置页的 AgentPresetCard 与边栏会话设置共用这一份；
// 可选项来自 agentPresets/list 名录经 agentPreset.ts 过滤取词，命名空间缺失或
// 名录里没有开放的模式时 current 为 null（调用方隐藏入口，引擎降级口径）。
import { useCallback, useEffect, useState } from "react";
import { alertDialog } from "../components/DialogHost";
import { t, tt } from "../i18n";
import { useStore } from "../store";
import { agentPresetLabel, visibleAgentPresets } from "./agentPreset";
import { SettingsConflictError, useSettingNamespace } from "./useSettingNamespace";

export function useAgentPresetDefault() {
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

  const options = visibleAgentPresets(presets).map((p) => ({ v: p.id, label: agentPresetLabel(p) }));
  return { current, options, save };
}
