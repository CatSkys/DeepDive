// 插件页「插件」tab：用户装进来的插件清单 + 逐行开关。
//
// 只列**用户可安装可使用的插件**：引擎自带的内部模块（`@deepseek-ai/*` 与
// `cordis:*`，随自有组合包发布）不在这里显示——它们不是用户装的东西，开关对它们
// 也没有意义（工具类挂在 agent preset 组合里，见 model.ts 顶部那段实测事实）。
// 判据与分组归 `model.ts` 的 `isBundledModule`。
//
// 数据两处合起来才是真相：`pluginInventory/list`（引擎只读投影，直读）说明每行的
// 挂载与运行状态；壳的 `pluginPatchList()` 说明**哪些行是用户关掉的**——两者在
// inventory 里都是 `enabled:false`，混在一起会让开关看着"点了没反应"（PITFALLS §7.6）。
//
// 开关落盘后由引擎 `patchReload: live` 热重载，不重启进程；实测数秒内翻转，
// 所以拨完延迟一拍重拉清单，并留一个手动刷新入口兜底。

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { api, type PluginInventoryEntry } from "../api";
import { RowMenu, Toggle, type RowMenuItem } from "../components/controls";
import { alertDialog, confirmDialog } from "../components/DialogHost";
import {
  inShell, pluginBundledNames, pluginPatchList, pluginPatchSet, pluginUninstall,
  restartEngine, type PluginPatchToggle,
} from "../host";
import { useT } from "../i18n";
import rs from "../settings/SettingsRows.module.css";
import css from "./Plugins.module.css";
import {
  isBundledModule, matchesQuery, pluginState, pluginTogglable, rowIdOf,
  shortModuleName, sortPluginRows, type PluginRowLike, type PluginState,
} from "./model";

const STATE_KEY: Record<PluginState, string> = {
  active: "已启用",
  failed: "启动失败",
  starting: "启动中",
  idle: "未运行",
  off: "本层未挂载",
  conditional: "按条件启用",
  offByUser: "已关闭",
};

/** 一插件一色相（参考图的彩色图标位）：模块名字符和取模，同一插件恒同色。 */
const GLYPH_COLORS = ["#3B82F6", "#EF4444", "#22C55E", "#F59E0B", "#A855F7", "#6366F1", "#EC4899"];

function glyphColor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return GLYPH_COLORS[hash % GLYPH_COLORS.length];
}

function PluginGlyph({ moduleName }: { moduleName: string }) {
  return (
    <span className={css.glyph} style={{ background: glyphColor(moduleName) }} aria-hidden="true">
      {shortModuleName(moduleName).slice(0, 1)}
    </span>
  );
}

/** 状态徽章：颜色只分两档（可操作 / 其它），文字才是信息。 */
function StateBadge({ state }: { state: PluginState }) {
  const { t } = useT();
  const on = state === "active";
  return (
    <span className={rs.badge}>
      <span className={`${rs.badgeDot}${on ? " on" : ""}`} />
      <span className={`${rs.badgeText}${on ? " on" : ""}`}>{t(STATE_KEY[state])}</span>
    </span>
  );
}

export function PluginsTab({ query, onTryPlugin }: {
  query: string;
  onTryPlugin: (moduleName: string) => void;
}) {
  const { t, tt } = useT();
  const [entries, setEntries] = useState<PluginInventoryEntry[] | null>(null);
  const [patches, setPatches] = useState<PluginPatchToggle[]>([]);
  const [bundledNames, setBundledNames] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const shell = inShell();

  const load = useCallback(() => {
    api.pluginInventory()
      .then((snapshot) => { setEntries(snapshot.entries); setError(false); })
      .catch(() => { setEntries([]); setError(true); });
    if (shell) {
      void pluginPatchList().then(setPatches);
      void pluginBundledNames().then(setBundledNames);
    }
  }, [shell]);
  useEffect(load, [load]);

  const offByUser = useMemo(
    () => new Set(patches.filter((p) => p.disabled).map((p) => p.rowId)),
    [patches],
  );

  const stateOf = useCallback(
    (row: PluginRowLike): PluginState => {
      const rowId = rowIdOf(row.entryId);
      return pluginState(row, rowId !== null && offByUser.has(rowId));
    },
    [offByUser],
  );

  const toggle = async (row: PluginInventoryEntry, next: boolean) => {
    const rowId = rowIdOf(row.entryId);
    if (rowId === null) return;
    setBusy(row.entryId);
    const result = await pluginPatchSet(rowId, !next);
    if (!result.ok) {
      setBusy(null);
      return;
    }
    setPatches((prev) => [...prev.filter((p) => p.rowId !== rowId), { rowId, disabled: !next }]);
    // 引擎 chokidar 热重载 → 清单翻转有一拍延迟，等到那一拍再拉
    window.setTimeout(() => { setBusy(null); load(); }, 1500);
  };

  const uninstall = async (entry: PluginInventoryEntry) => {
    const ok = await confirmDialog({
      message: tt(
        "卸载插件「{name}」？会从 profile 里摘掉它并重启引擎（期间几秒不可用）。要装回来用 dsh plugin add。",
        "Uninstall “{name}”? It is removed from the profile and the engine restarts (a few seconds offline). Reinstall with dsh plugin add.",
        { name: entry.moduleName },
      ),
      confirmLabel: t("卸载"),
      cancelLabel: t("取消"),
    });
    if (!ok) return;
    const result = await pluginUninstall(entry.moduleName);
    if (!result.ok) {
      await alertDialog({ message: result.error ?? t("卸载失败") });
      return;
    }
    // bundle 成员有启动边界：不重启引擎，卸载不会生效
    restartEngine();
  };

  const renderRow = (entry: PluginInventoryEntry) => {
    const state = stateOf(entry);
    const rowId = rowIdOf(entry.entryId);
    const items: RowMenuItem[] = [{ v: "try", label: t("立即试用"), icon: Sparkles }];
    // 随应用发布的行删了下次启动会回来，不给卸载入口（骗人的按钮比没有更糟）
    if (!isBundledModule(entry.moduleName) && !bundledNames.includes(entry.moduleName)) {
      items.push({ v: "uninstall", label: t("卸载"), icon: Trash2, danger: true });
    }
    return (
      <div
        key={entry.entryId}
        className={`${rs.blockRow}${state === "offByUser" ? ` ${css.rowOff}` : ""}`}
        title={rowId ?? undefined}
      >
        <PluginGlyph moduleName={entry.moduleName} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className={rs.rowName}>{shortModuleName(entry.moduleName)}</div>
          <div className={css.rowMeta}>{entry.moduleName}</div>
        </div>
        <RowMenu
          label={t("更多")}
          items={items}
          onSelect={(v) => { if (v === "try") onTryPlugin(entry.moduleName); else void uninstall(entry); }}
        />
        {pluginTogglable(state) && rowId !== null ? (
          <Toggle on={state !== "offByUser"} onChange={(v) => { if (busy === null) void toggle(entry, v); }} />
        ) : (
          <StateBadge state={state} />
        )}
      </div>
    );
  };

  if (error) {
    return (
      <div className={rs.blockCard}>
        <div className={rs.blockRow}>
          <span className={rs.muted}>{t("引擎未连接，或这个版本的引擎没有插件清单接口。")}</span>
        </div>
      </div>
    );
  }

  const rows = (entries ?? []).filter((e) => matchesQuery(e.moduleName, e.entryId, query));
  const installed = sortPluginRows(rows.filter((e) => !isBundledModule(e.moduleName)));

  return (
    <>
      <div className={css.groupHead}>
        <div className={css.groupLabel}>
          {tt("已安装（{n}）", "Installed ({n})", { n: String(installed.length) })}
        </div>
        <button className={rs.secondaryButton} onClick={load} disabled={busy !== null}>
          <RefreshCw size={12} /> {t("刷新")}
        </button>
      </div>
      <div className={rs.blockCard}>
        {installed.length === 0 && (
          <div className={rs.blockRow}>
            <span className={rs.muted}>{query.trim().length > 0 ? t("没有匹配的插件。") : t("还没有安装第三方插件。")}</span>
          </div>
        )}
        {installed.map(renderRow)}
      </div>
    </>
  );
}
