// Agent 会话预设的两个呈现位：hero 下拉选择器（新会话落点用哪个模式建会话）
// 与会话头模式胶囊（当前会话的预设标识，无显式预设时显示引擎默认）。
// 数据 = store.presets（agentPreset.list 一次性拉取）；为空（引擎无预设面）
// 时两个入口都显式不渲染。
import { useStore } from "../store";
import { tt } from "../i18n";
import { Dropdown } from "../settings/controls";

export function AgentModePicker() {
  const { presets, heroPreset, setHeroPreset } = useStore();
  if (presets.length === 0) return null;
  const active = heroPreset ?? presets.find((p) => p.isDefault)?.id ?? presets[0].id;
  return (
    <div className="mode-picker">
      <Dropdown
        variant="bare"
        options={presets.map((p) => ({ v: p.id, label: p.name }))}
        value={active}
        onChange={setHeroPreset}
      />
    </div>
  );
}

export function PresetPill() {
  const { presets, sessions, activeSessionId } = useStore();
  const summary = sessions.find((s) => s.sessionId === activeSessionId);
  if (!summary) return null; // hero 页由选择器承担，不重复出胶囊
  const id = summary.agentPreset ?? presets.find((p) => p.isDefault)?.id;
  const preset = presets.find((p) => p.id === id);
  if (!preset) return null;
  return (
    <span className="ws-pill preset-pill" data-tip={tt("会话模式", "Session mode")}>
      <span className="ws-pill-name">{preset.name}</span>
    </span>
  );
}
