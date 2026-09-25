// 右侧边栏的「会话设置」页（照 ZCode 的 Chat Settings：面板内切视图，右上角齿轮进、左上角返回出）。
// 四项都复用现成的读写通道，没有新契约：
//   模型   —— useSessionModels 的 face + ModelMenu（内联变体）
//   权限   —— 引擎已经把会话权限投影成下拉视图（permissions: {options, currentValue}），
//             写入只有 /permission <preset> 一条路（引擎注释原话：the one write path a web client uses）
//   插件   —— plugins/PluginsTab 原样内嵌
//   发送方式 —— 引擎 ui-conversation.busyEnter（全局设置，与设置→通用同源；引擎没有会话级开关）

import { useEffect, useState } from "react";
import { api } from "../api";
import { t, tt } from "../i18n";
import { alertDialog } from "../components/DialogHost";
import { Dropdown } from "../components/controls";
import { ModelMenu } from "../components/ModelMenu";
import { PluginsTab } from "../plugins/PluginsTab";
import { SettingsConflictError, useSettingNamespace } from "../settings/useSettingNamespace";
import type { ModelFace } from "../session/SessionHeader";

/** 会话权限投影的 wire 视图（引擎 permission-presets 注册的 viewSchema）。 */
export interface PermissionSelect {
  options: Array<{ value: string; name: string; description?: string }>;
  currentValue: string;
}

export function SessionSettings({ sessionId, face, permissions, onOpenPlugins }: {
  sessionId: string;
  face: ModelFace;
  /** 会话权限的投影视图（调用方从 summary.projections.values.permissions 取）；读不到就不显示这一区。 */
  permissions: PermissionSelect | null;
  /** 插件页的"去装一个"落点：切到设置页的插件分区（面板里不重造安装流程）。 */
  onOpenPlugins: () => void;
}) {
  const [current, setCurrent] = useState<string | null>(null);
  const [showModels, setShowModels] = useState(false);
  const [busy, setBusy] = useState("");
  const { describe: describeUiNs, update: updateUiNs } = useSettingNamespace("ui-conversation");

  // 本地乐观值只用于点击后立刻反映；投影推进后以投影为准
  const currentValue = current ?? permissions?.currentValue ?? "";

  useEffect(() => {
    void (async () => {
      try {
        const v = ((await describeUiNs())?.value as { busyEnter?: string } | null)?.busyEnter;
        if (v) setBusy(v);
      } catch { /* engine booting */ }
    })();
  }, [describeUiNs]);

  const saveBusy = async (v: string) => {
    setBusy(v);
    try {
      await updateUiNs({ busyEnter: v });
    } catch (err) {
      void alertDialog(err instanceof SettingsConflictError
        ? { message: t("版本已前进——请取消后重新打开(将载入最新)") }
        : { message: tt("保存失败：{m}", "Save failed: {m}", { m: (err as Error).message }) });
    }
  };

  const pickPermission = (preset: string) => {
    setCurrent(preset);
    // 引擎只有命令这一条写路；失败（会话不在跑/引擎忙）由投影纠偏，这里不静默兜底
    void api.commandExecute({ agentId: sessionId, line: `/permission ${preset}` }).catch(() => undefined);
  };

  return (
    <div className="panel-settings">
      <div className="panel-settings-section">
        <div className="panel-settings-label">{t("模型")}</div>
        <button
          type="button"
          className="panel-settings-row"
          data-open={showModels ? "true" : "false"}
          onClick={() => setShowModels((v) => !v)}
        >
          <span className="panel-settings-value">{face.modelName || t("跟随默认")}</span>
          <span className="panel-settings-meta">{face.effortLabel(face.effort)}</span>
        </button>
        {showModels && (
          <ModelMenu
            inline
            options={face.models}
            current={face.modelName}
            currentModel={face.currentModel}
            effortValue={face.effort}
            onPick={(m) => void face.pickModel(m)}
            onApplyEffort={(m, id) => void face.applyModelEffort(m, id)}
            onClose={() => setShowModels(false)}
          />
        )}
      </div>

      {permissions !== null && (
        <div className="panel-settings-section">
          <div className="panel-settings-label">{t("权限")}</div>
          <div className="panel-settings-list">
            {permissions.options.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`panel-settings-choice${o.value === currentValue ? " active" : ""}`}
                onClick={() => pickPermission(o.value)}
              >
                <span className="panel-settings-choice-name">{o.name}</span>
                {o.description !== undefined && <span className="panel-settings-choice-desc">{o.description}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="panel-settings-section">
        <div className="panel-settings-label">{t("发送方式")}</div>
        <div className="panel-settings-row static">
          <Dropdown
            options={[{ v: "steer", label: t("插话发送") }, { v: "queue", label: t("排队") }]}
            value={busy}
            onChange={(v) => void saveBusy(v)}
          />
        </div>
        <div className="panel-settings-hint">{t("仅在智能体运行时生效;Cmd/Ctrl+Enter 使用另一行为")}</div>
      </div>

      <div className="panel-settings-section">
        <div className="panel-settings-label">{t("插件")}</div>
        <div className="panel-settings-plugins">
          <PluginsTab query="" onTryPlugin={() => onOpenPlugins()} />
        </div>
      </div>
    </div>
  );
}
