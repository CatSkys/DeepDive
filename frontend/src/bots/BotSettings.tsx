import { useState } from "react";
import css from "./Bots.module.css";
import rowsCss from "../settings/SettingsRows.module.css";
import { Dropdown } from "../components/controls";
import { api, type ImBot, type ImModelOption, type ImSnapshot } from "../api";
import { useT } from "../i18n";

// 机器人细项：别名 / 工作区 / 模型 / Agent 预设。
//
// 四个端点统一 `{botId, …载荷}` 且都回**新快照**（参数名取自插件客户端源码的
// saveBotSetting，勿猜）；调用方拿快照整体替换，不本地拼状态。
// 提交时机：文字项失焦/回车且**改过才发**；下拉项选中即发。
//
// 未做的两项（本轮不含）：访问策略（direct/group × open/allowlist 的嵌套形状，
// 插件自带整页编辑器）、上下文增强（config 形状另议）。

/** 模型选项在 Dropdown 里的值：提供方与模型 id 拼成一个键，取回时拆开。
 *  用 NUL 分隔——插件侧 id 经 cleanId 清洗，不含控制字符。 */
const MODEL_SEP = "\u0000";
const modelKey = (provider: string, model: string) => `${provider}${MODEL_SEP}${model}`;

export function BotSettings({ channel, bot, models, presets, onSaved, onError }: {
  channel: string;
  bot: ImBot;
  models: ImModelOption[];
  presets: Array<{ id: string; label: string }>;
  onSaved: (snapshot: ImSnapshot) => void;
  onError: (message: string) => void;
}) {
  const { t } = useT();
  const [alias, setAlias] = useState(bot.bot.name);
  const [workspace, setWorkspace] = useState(bot.workspace);
  const [saving, setSaving] = useState(false);

  const save = (call: () => Promise<ImSnapshot>) => {
    setSaving(true);
    void call().then(onSaved).catch((e: Error) => onError(e.message)).finally(() => setSaving(false));
  };

  const commitAlias = () => {
    const next = alias.trim();
    if (next && next !== bot.bot.name) save(() => api.im.setBotAlias(channel, bot.botId, next));
  };
  const commitWorkspace = () => {
    const next = workspace.trim();
    if (next !== bot.workspace) save(() => api.im.setBotWorkspace(channel, bot.botId, next));
  };

  return (
    <div className={css.settings} data-busy={saving || undefined}>
      <label className={css.settingRow}>
        <span className={css.settingLabel}>{t("别名")}</span>
        <input
          className={`${rowsCss.textField} ${css.settingControl}`}
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          onBlur={commitAlias}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        />
      </label>

      <label className={css.settingRow}>
        <span className={css.settingLabel}>{t("工作区")}</span>
        <input
          className={`${rowsCss.textField} ${css.settingControl}`}
          placeholder={t("绝对路径；留空用引擎默认")}
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
          onBlur={commitWorkspace}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        />
      </label>

      {/* 目录为空（插件没给）时不渲染该项——不摆一个点不动的空下拉 */}
      {models.length > 0 && (
        <div className={css.settingRow}>
          <span className={css.settingLabel}>{t("模型")}</span>
          <span className={css.settingControl}>
            <Dropdown
              options={models.map((m) => ({ v: modelKey(m.provider, m.model), label: m.label, description: m.provider }))}
              value={bot.model ? modelKey(bot.model.provider, bot.model.model) : ""}
              onChange={(v) => {
                const [provider, model] = v.split(MODEL_SEP);
                if (provider && model) save(() => api.im.setBotModel(channel, bot.botId, { provider, model }));
              }}
            />
          </span>
        </div>
      )}

      {presets.length > 0 && (
        <div className={css.settingRow}>
          <span className={css.settingLabel}>{t("Agent 预设")}</span>
          <span className={css.settingControl}>
            <Dropdown
              options={presets.map((p) => ({ v: p.id, label: p.label }))}
              value={bot.agentPreset}
              onChange={(v) => save(() => api.im.setBotPreset(channel, bot.botId, v))}
            />
          </span>
        </div>
      )}
    </div>
  );
}
