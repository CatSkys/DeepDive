// 插件与技能分区的纯逻辑：状态判定、命名短化、排序、汇总——视图之外的一切判断都在这儿。
//
// 一条实测事实决定状态模型（2026-09-17 对引脚引擎实机核对，`pluginInventory/list` 160 行）：
// Loader 层有 27 行 `enabled:false`——而它们是 `tool-bash` / `tool-fs` / `skill-filesystem`
// 这类**模型工具**，在应用里明明可用。原因是工具/插件挂在 **agent preset 组合**里
// （`standard` 预设的 `tool-bash` 是 `active`），Loader 层那些同名行从来没被挂载。
// 所以 `enabled:false` 只能读成「本层没挂载它」，绝不能读成「用户关掉了」。
//
// 「用户关掉的」另有出处：home 级 patch 层 `<DSH_HOME>/cordis.patch.yml` 的托管段
// （壳的 PluginPatchAdmin 读写，引擎 `patchReload: live` 热重载）。两者在 inventory 里
// 都是 `enabled:false`，混在一起会让开关看着「点了没反应」——所以这里显式分成
// `offByUser` 与 `unmounted` 两态，只有前者给开关。

import type { PluginFiberPhase, PluginPresetRow } from "../api";

/** 一行插件在页面上的展示状态。 */
export type PluginState = "active" | "failed" | "starting" | "idle" | "off" | "conditional" | "offByUser";

/** 一行 PluginsRow 的最小形状（Loader 条目与预设组合行共用同一套判定）。 */
export interface PluginRowLike {
  moduleName: string;
  entryId: string | null;
  enabled: boolean | "conditional";
  fiberPhase: PluginFiberPhase;
}

export function pluginState(row: Pick<PluginRowLike, "enabled" | "fiberPhase">, offByUser = false): PluginState {
  // 用户显式关掉的最优先：patch 落账比本层是否挂载更能说明"为什么它是关的"
  if (offByUser) return "offByUser";
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

/** inventory 的 entryId（`include:hmr`）→ patch 的目标**行 id**（`hmr`）。
    写 entryId 进 patch 只会 warn `entry not found`（PITFALLS §7.6）；剥法同官方
    PluginInventorySettingsTab 的 `entrySubtitle`。 */
export function rowIdOf(entryId: string | null): string | null {
  if (entryId === null || entryId.length === 0) return null;
  const stripped = entryId.replace(/^include:/, "");
  return stripped.length === 0 ? null : stripped;
}

/** 模块名短化（官方 `moduleShortName` 同款）：剥 scope 与各层前缀，留给列表一眼可读的名字。 */
export function shortModuleName(moduleName: string): string {
  const unscoped = moduleName.startsWith("@") ? moduleName.slice(moduleName.indexOf("/") + 1) : moduleName;
  return unscoped
    .replace(/^cordis:/, "")
    .replace(/^cordis-plugin-/, "")
    .replace(/^dsh-(?:host-|client-)?/, "");
}

/** 一行能否给出有效开关。
    只有「已挂载」与「用户关掉的」两种态可拨：对 `unmounted` 行拨开关是空操作
    （工具类挂在 preset 组合里，本层那行不是它的真身），对 `conditional` 行无从判断。 */
export function pluginTogglable(state: PluginState): boolean {
  return state === "active" || state === "starting" || state === "failed" || state === "offByUser";
}

/** 一行是否属于引擎自带模块（而非用户装进来的插件）。
    用户装的是 profile 的 bundle/pnpm 依赖（`dsh-chat-import`、`@everos-ai/dsh-plugin`…），
    其余 `@deepseek-ai/*` 与 `cordis:*` 都是随引擎发布的内部模块——两者在列表里价值不同：
    前者是用户认得、也真想管的东西，后者摊开只会淹掉它。 */
export function isBundledModule(moduleName: string): boolean {
  return moduleName.startsWith("@deepseek-ai/") || moduleName.startsWith("cordis:");
}

/** 一行是否命中搜索词（模块名、行 id、短名任一命中）。 */
export function matchesQuery(moduleName: string, entryId: string | null, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) return true;
  const haystack = [moduleName, shortModuleName(moduleName), rowIdOf(entryId) ?? ""];
  return haystack.some((value) => value.toLocaleLowerCase().includes(needle));
}
