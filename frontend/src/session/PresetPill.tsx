// 会话头的模式胶囊：当前会话用哪个模式（无显式预设时按引擎默认解析）。
// 只读呈现——模式的选定在设置页「会话模式」（新建会话生效，引擎侧创建即锁）。
// 开放清单外的模式（引擎随包 ptc / cordis）不呈现，历史会话因此没有胶囊。
import { useStore } from "../store";
import { tt } from "../i18n";
import { agentPresetLabel, visibleAgentPresets } from "../settings/agentPreset";

export function PresetPill() {
  const { presets, sessions, activeSessionId } = useStore();
  const summary = sessions.find((s) => s.sessionId === activeSessionId);
  if (!summary) return null; // hero 页由招呼语承担，不重复出胶囊
  const open = visibleAgentPresets(presets);
  const id = summary.agentPreset ?? open.find((p) => p.isDefault)?.id;
  const preset = open.find((p) => p.id === id);
  if (!preset) return null;
  return (
    <span className="ws-pill preset-pill" data-tip={tt("会话模式", "Session mode")}>
      <span className="ws-pill-name">{agentPresetLabel(preset)}</span>
    </span>
  );
}
