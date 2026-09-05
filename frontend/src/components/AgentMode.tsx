// Agent 会话预设的两个呈现位：hero 下拉选择器（新会话落点用哪个模式建会话）
// 与会话头模式胶囊（当前会话的预设标识，无显式预设时显示引擎默认）。
// 数据 = store.presets（agentPreset.list 一次性拉取）；为空（引擎无预设面）
// 时两个入口都显式不渲染。
import { useStore } from "../store";
import { tt } from "../i18n";
import type { AgentPreset } from "../api";
import { Dropdown } from "../components/controls";

// 引擎内建预设的 name 是引擎侧原样中文，展示文案随 UI 语言走词典；
// 只翻 trust==='system' 且 id 命中的四项，用户自建预设保留引擎文本
// （与官方 UI presetDisplayText 同一判定，词表同 vendored locales.ts）。
const BUILTIN_PRESET_NAMES: Record<string, { zh: string; en: string }> = {
  standard: { zh: "标准模式", en: "Standard mode" },
  code: { zh: "PTC 模式", en: "PTC mode" },
  minimal: { zh: "极简模式", en: "Minimal mode" },
  cordis: { zh: "创造模式", en: "Creator mode" },
};

function presetName(preset: AgentPreset): string {
  const builtin = preset.trust === "system" ? BUILTIN_PRESET_NAMES[preset.id] : undefined;
  return builtin ? tt(builtin.zh, builtin.en) : preset.name;
}

export function AgentModePicker() {
  const { presets, heroPreset, setHeroPreset } = useStore();
  if (presets.length === 0) return null;
  const active = heroPreset ?? presets.find((p) => p.isDefault)?.id ?? presets[0].id;
  return (
    <div className="mode-picker">
      <Dropdown
        variant="bare"
        options={presets.map((p) => ({ v: p.id, label: presetName(p) }))}
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
      <span className="ws-pill-name">{presetName(preset)}</span>
    </span>
  );
}
