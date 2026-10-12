// 右侧边栏的「会话设置」页（照 ZCode 的 Chat Settings：面板内切视图，右上角齿轮进、左上角返回出）。
// 各行复用现成的读写通道，没有新契约，形态与设置页同一套（左文字右选项的行式）：
//   模型       —— useSessionModels 的 face + ModelMenu（挂 body 的弹层，不挤动下方分区）
//   会话模式   —— 当前会话 pin 的 agent preset；切换走 agentPresets/select（引擎在
//               轮与轮之间重组 agent，turn 在途拒绝——2026-10-11 用户定稿：会话中可切）
//   权限       —— 引擎已经把会话权限投影成下拉视图（permissions: {options, currentValue}），
//               写入只有 /permission <preset> 一条路（引擎注释原话：the one write path a web client uses）
//   发送方式   —— 引擎 conversation.busyEnter（全局设置，与设置→通用同源；引擎没有会话级开关）
//   插件       —— plugins/PluginsTab 原样内嵌

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { api } from "../api";
import { t, tt } from "../i18n";
import { alertDialog } from "../components/DialogHost";
import { Dropdown } from "../components/controls";
import { ModelMenu } from "../components/ModelMenu";
import { PluginsTab } from "../plugins/PluginsTab";
import { agentPresetLabel, visibleAgentPresets } from "../settings/agentPreset";
import { presetDropdownOptions, type PermissionSelect } from "../settings/permissionPreset";
import { SettingsConflictError, useSettingNamespace } from "../settings/useSettingNamespace";
import { useStore } from "../store";
import type { ModelFace } from "../session/SessionHeader";

/** 会话中切换的模式（展示层乐观记录）：summary 的 agentPreset 来自会话头 pin，
 *  会话中切换不改头——用这份让面板重开后仍显示切换后的值。引擎的
 *  agent-preset/selected 事件是权威，此处只管展示连续性。 */
const modeOverrides = new Map<string, string>();

export function SessionSettings({ sessionId, face, agentPreset, permissions, onOpenPlugins }: {
  sessionId: string;
  face: ModelFace;
  /** 当前会话 pin 的 agent preset id（summary 投影；空 = 引擎降级，隐藏入口）。 */
  agentPreset?: string;
  /** 会话权限的投影视图（调用方从 summary.projections.values.permissions 取）；读不到就不显示这一区。 */
  permissions: PermissionSelect | null;
  /** 插件页的"去装一个"落点：切到设置页的插件分区（面板里不重造安装流程）。 */
  onOpenPlugins: () => void;
}) {
  const [current, setCurrent] = useState<string | null>(null);
  const [showModels, setShowModels] = useState(false);
  const [busy, setBusy] = useState("");
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const { describe: describeUiNs, update: updateUiNs } = useSettingNamespace("conversation");
  const { presets } = useStore();

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

  // 当前会话 pin 的模式不在开放清单（用户自建预设）也照实列出，别让下拉显示成空
  const modeOptions = visibleAgentPresets(presets).map((p) => ({ v: p.id, label: agentPresetLabel(p) }));
  const pinned = modeOverrides.get(sessionId) ?? agentPreset ?? "";
  const sessionModeOptions = pinned && !modeOptions.some((o) => o.v === pinned)
    ? [{ v: pinned, label: pinned }, ...modeOptions]
    : modeOptions;

  const pickMode = (v: string) => {
    modeOverrides.set(sessionId, v);
    void api.agentPresetSelect({ agentId: sessionId, agentPreset: v }).catch((err) => {
      modeOverrides.delete(sessionId);
      void alertDialog({ message: tt("切换失败：{m}", "Switch failed: {m}", { m: (err as Error).message }) });
    });
  };

  return (
    <div className="panel-settings">
      <button
        ref={modelTriggerRef}
        type="button"
        className="panel-settings-line panel-settings-row"
        data-open={showModels ? "true" : "false"}
        onClick={() => setShowModels((v) => !v)}
      >
        <span className="panel-settings-label">{t("模型")}</span>
        <span className="panel-settings-value">
          <span className="panel-settings-value-text">{face.modelName || t("跟随默认")}</span>
          <ChevronDown size={14} className="panel-settings-chev" />
        </span>
      </button>
      {showModels && (
        <ModelMenu
          options={face.models}
          current={face.modelName}
          currentModel={face.currentModel}
          onPick={(m) => void face.pickModel(m)}
          onClose={() => setShowModels(false)}
          anchorRef={modelTriggerRef}
        />
      )}

      {pinned && sessionModeOptions.length > 0 && (
        <div className="panel-settings-line">
          <div className="panel-settings-identity">
            <div className="panel-settings-label">{t("会话模式")}</div>
            <div className="panel-settings-hint">{t("切换在下一轮对话生效。")}</div>
          </div>
          <Dropdown options={sessionModeOptions} value={pinned} onChange={pickMode} variant="bare" />
        </div>
      )}

      {permissions !== null && (
        <div className="panel-settings-line">
          <div className="panel-settings-identity">
            <div className="panel-settings-label">{t("权限")}</div>
          </div>
          <Dropdown
            options={presetDropdownOptions(permissions.options, t)}
            value={currentValue}
            onChange={pickPermission}
            variant="bare"
          />
        </div>
      )}

      <div className="panel-settings-line">
        <div className="panel-settings-identity">
          <div className="panel-settings-label">{t("发送方式")}</div>
          <div className="panel-settings-hint">{t("仅在智能体运行时生效;Cmd/Ctrl+Enter 使用另一行为")}</div>
        </div>
        <Dropdown
          options={[{ v: "steer", label: t("插话发送") }, { v: "queue", label: t("排队") }]}
          value={busy}
          onChange={(v) => void saveBusy(v)}
          variant="bare"
        />
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
