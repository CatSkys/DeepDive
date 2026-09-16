// 技能与插件分区的纯逻辑：状态判定、排序、汇总——视图之外的一切判断都在这儿。
//
// 一条实测事实决定这里的状态模型（2026-09-16 对引脚引擎实机核对）：
// `pluginInventory/list` 的 Loader 层有 160 行，其中 27 行 `enabled:false`——而它们是
// `tool-bash` / `tool-fs` / `skill-filesystem` 这类**模型工具**，在应用里明明可用。
// 原因是工具/插件挂在 **agent preset 组合**里（`standard` 预设的 `tool-bash` 是
// `active`），Loader 层那些同名行从来没被挂载。所以 `enabled:false` 只能读成
// 「本层没挂载它」，绝不能读成「用户关掉了」——据此，设置页不再提供插件开关：
// 对工具行开关无效（开关的是那一层空壳），对核心行开关只会把应用搞坏。

import type { PluginFiberPhase, PluginPresetRow } from "../api";

/** 一行插件在本层的展示状态。 */
export type PluginState = "active" | "failed" | "starting" | "idle" | "off" | "conditional";

/** 一行 PluginsRow 的最小形状（Loader 条目与预设组合行共用同一套判定）。 */
export interface PluginRowLike {
  moduleName: string;
  entryId: string | null;
  enabled: boolean | "conditional";
  fiberPhase: PluginFiberPhase;
}

export function pluginState(row: Pick<PluginRowLike, "enabled" | "fiberPhase">): PluginState {
  if (row.enabled === false) return "off";
  // `!!js` 行：只有 Loader context 能判定，这里如实报"按条件"，不猜它开没开
  if (row.enabled === "conditional") return "conditional";
  switch (row.fiberPhase) {
    case "active": return "active";
    case "failed": return "failed";
    case "loading":
    case "pending":
    case "unloading": return "starting";
    default: return "idle";
  }
}

/** 预设组合行 → 判定形状（组合行的 entryId 可能没写）。 */
export function presetRowLike(row: PluginPresetRow): PluginRowLike {
  return { moduleName: row.moduleName, entryId: row.entryId, enabled: row.enabled, fiberPhase: row.fiberPhase };
}

/** 按模块名排序：引擎给的是 Loader 顺序（装了什么就跟着变），不利于回看与对比。 */
export function sortPluginRows<T extends PluginRowLike>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => a.moduleName.localeCompare(b.moduleName) || (a.entryId ?? "").localeCompare(b.entryId ?? ""),
  );
}

export interface PluginSummary {
  total: number;
  active: number;
  failed: number;
  off: number;
}

export function summarizePluginRows(rows: PluginRowLike[]): PluginSummary {
  const summary: PluginSummary = { total: rows.length, active: 0, failed: 0, off: 0 };
  for (const row of rows) {
    const state = pluginState(row);
    if (state === "active") summary.active += 1;
    else if (state === "failed") summary.failed += 1;
    else if (state === "off") summary.off += 1;
  }
  return summary;
}
