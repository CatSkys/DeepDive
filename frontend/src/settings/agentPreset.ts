// Agent 会话模式（引擎 agent preset）在客户端的选择面：开放哪几个、各叫什么。
// 引擎的 `agentPresets/list` 永远返回随包全部预设（shipped root 不可删），所以
// "产品只开放哪几个"是本模块的裁决——会话头胶囊、设置页默认模式、机器人设置
// 三处都经这里过滤取词，不各自抄一份清单。拉取与行型在 api.ts（AgentPreset），
// 本模块不管数据面。
import type { AgentPreset } from "../api";
import { tt } from "../i18n";

/** 开放给用户的模式，按展示顺序。引擎随包的 ptc / cordis 不在此列。
 *  内建预设的 name 是引擎侧原样中文，展示文案走这里的双语词表（设置页下拉与
 *  会话头胶囊共用，同一概念全项目一个词）；不在表内的（用户自建预设）保留引擎
 *  文本——与官方 UI presetDisplayText 同一判定。 */
const MODES: Array<{ id: string; zh: string; en: string }> = [
  { id: "standard", zh: "标准", en: "Standard" },
  { id: "minimal", zh: "极简", en: "Minimal" },
];

/** 按开放清单过滤并排序（引擎名录顺序不承载产品意图，清单顺序才是展示顺序）。 */
export function visibleAgentPresets<T extends { id: string }>(rows: T[]): T[] {
  return MODES.flatMap((m) => rows.filter((r) => r.id === m.id));
}

/** 展示名：内建且 trust==='system' 走词典，否则用引擎原文（用户自建预设）。 */
export function agentPresetLabel(preset: AgentPreset): string {
  const builtin = preset.trust === "system" ? MODES.find((m) => m.id === preset.id) : undefined;
  return builtin ? tt(builtin.zh, builtin.en) : preset.name ?? preset.id;
}
