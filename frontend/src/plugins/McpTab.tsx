// 插件页「MCP」tab：MCP server 的列表、启停与增删改。
//
// 一个 server 由壳写进 home 级 patch 层的托管块（`@deepseek-ai/dsh-mcp-client` 一行，
// 挂载形状见 docs/TODO.md §7），引擎 `patchReload: live` 热重载——所以拨开关、
// 增删都不会重启进程。模型侧工具名是 `mcp__<serverName>__<tool>`。
//
// 密钥面（env / headers）本轮**没接**：密钥要走既有凭据面，不能落进这份明文 patch
// 文件。编辑弹窗对这一点显式说明，不做一个看起来能用、其实把密钥写进明文的输入框。

import { useCallback, useEffect, useState } from "react";
import { Plus, Settings, Trash2 } from "lucide-react";
import { Toggle } from "../components/controls";
import { alertDialog, confirmDialog } from "../components/DialogHost";
import { inShell, mcpServersList, mcpServersSave, type McpServerRow } from "../host";
import { useT } from "../i18n";
import rs from "../settings/SettingsRows.module.css";
import css from "./Plugins.module.css";

/** 空草稿：新增时的起点。 */
function blankServer(): McpServerRow {
  return { rowId: "", name: "", transport: "stdio", command: "", args: [], url: "", enabled: true };
}

/** 编辑弹窗：字段用 grid 排（PITFALLS §1.6：不要用 flex 子项嵌百分比宽表单控件）。 */
function ServerDialog({ draft, isNew, onCancel, onSave, onDelete }: {
  draft: McpServerRow;
  isNew: boolean;
  onCancel: () => void;
  onSave: (row: McpServerRow) => void;
  onDelete: () => void;
}) {
  const { t } = useT();
  const [row, setRow] = useState<McpServerRow>(draft);
  const patch = (next: Partial<McpServerRow>) => setRow((prev) => ({ ...prev, ...next }));

  return (
    <div className="dialog-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dialog-card" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
        <div className="dialog-title">{isNew ? t("添加 MCP 服务器") : t("编辑 MCP 服务器")}</div>
        <div className={css.form}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t("名字")}</span>
            <input className="dialog-input" autoFocus value={row.name} onChange={(e) => patch({ name: e.target.value })} />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t("传输")}</span>
            <select className="dialog-input" value={row.transport} onChange={(e) => patch({ transport: e.target.value === "http" ? "http" : "stdio" })}>
              <option value="stdio">stdio</option>
              <option value="http">http</option>
            </select>
          </label>
          {row.transport === "http" ? (
            <label className={css.field}>
              <span className={css.fieldLabel}>URL</span>
              <input className="dialog-input" value={row.url} placeholder="https://…" onChange={(e) => patch({ url: e.target.value })} />
            </label>
          ) : (
            <>
              <label className={css.field}>
                <span className={css.fieldLabel}>{t("命令")}</span>
                <input className="dialog-input" value={row.command} placeholder="npx" onChange={(e) => patch({ command: e.target.value })} />
              </label>
              <label className={css.field}>
                <span className={css.fieldLabel}>{t("参数（空格分隔）")}</span>
                <input
                  className="dialog-input"
                  value={row.args.join(" ")}
                  onChange={(e) => patch({ args: e.target.value.split(/\s+/).filter((a) => a.length > 0) })}
                />
              </label>
            </>
          )}
          <div className={css.formNote}>{t("环境变量与请求头（密钥）本轮未接：密钥要走凭据面，不能落进明文的 patch 文件。")}</div>
        </div>
        <div className="dialog-actions">
          {!isNew && (
            <button type="button" className="dialog-btn danger" onClick={onDelete}>
              <Trash2 size={12} /> {t("删除")}
            </button>
          )}
          <button type="button" className="dialog-btn" onClick={onCancel}>{t("取消")}</button>
          <button type="button" className="dialog-btn primary" onClick={() => onSave(row)}>{t("保存")}</button>
        </div>
      </div>
    </div>
  );
}

export function McpTab({ query }: { query: string }) {
  const { t, tt } = useT();
  const [servers, setServers] = useState<McpServerRow[] | null>(null);
  const [editing, setEditing] = useState<{ row: McpServerRow; isNew: boolean } | null>(null);
  const shell = inShell();

  const load = useCallback(() => {
    if (!shell) { setServers([]); return; }
    void mcpServersList().then(setServers);
  }, [shell]);
  useEffect(load, [load]);

  const persist = async (next: McpServerRow[]): Promise<boolean> => {
    const result = await mcpServersSave(next);
    if (!result.ok) {
      await alertDialog({ message: result.error ?? t("保存失败") });
      return false;
    }
    setServers(next);
    return true;
  };

  const toggle = async (row: McpServerRow, on: boolean) => {
    await persist((servers ?? []).map((s) => (s.rowId === row.rowId ? { ...s, enabled: on } : s)));
  };

  const save = async (draft: McpServerRow) => {
    const rows = servers ?? [];
    const exists = rows.some((s) => s.rowId === draft.rowId);
    const ok = await persist(exists
      ? rows.map((s) => (s.rowId === draft.rowId ? draft : s))
      : [...rows, draft]);
    if (ok) setEditing(null);
  };

  const remove = async (row: McpServerRow) => {
    const ok = await confirmDialog({
      message: tt(
        "删除 MCP 服务器「{name}」？它提供的工具会从模型手里消失。",
        "Delete the MCP server “{name}”? Its tools disappear from the model.",
        { name: row.name },
      ),
      confirmLabel: t("删除"),
      cancelLabel: t("取消"),
    });
    if (!ok) return;
    if (await persist((servers ?? []).filter((s) => s.rowId !== row.rowId))) setEditing(null);
  };

  const needle = query.trim().toLocaleLowerCase();
  const visible = (servers ?? []).filter((s) => needle.length === 0 || s.name.toLocaleLowerCase().includes(needle));

  return (
    <>
      <div className={css.groupHead}>
        <div className={css.groupLabel}>{t("服务器")}</div>
        <button className={rs.secondaryButton} onClick={() => setEditing({ row: blankServer(), isNew: true })} disabled={!shell}>
          <Plus size={12} /> {t("添加")}
        </button>
      </div>
      <div className={rs.blockCard}>
        {!shell && (
          <div className={rs.blockRow}>
            <span className={rs.muted}>{t("MCP 服务器配在本机文件里，只有桌面应用能读写——当前是浏览器访问。")}</span>
          </div>
        )}
        {shell && servers !== null && servers.length === 0 && (
          <div className={rs.blockRow}>
            <span className={rs.muted}>{t("还没有 MCP 服务器。添加一个，它的工具会以 mcp__<名字>__<工具> 出现在模型手里。")}</span>
          </div>
        )}
        {shell && servers !== null && servers.length > 0 && visible.length === 0 && (
          <div className={rs.blockRow}>
            <span className={rs.muted}>{t("没有匹配的服务器。")}</span>
          </div>
        )}
        {visible.map((row) => (
          <div key={row.rowId} className={rs.blockRow}>
            <span className={rs.rowName}>{row.name}</span>
            <span className={css.rowMeta}>
              {row.transport === "http" ? row.url : [row.command, ...row.args].join(" ")}
            </span>
            <span style={{ marginLeft: "auto" }} />
            <button className={rs.secondaryButton} aria-label={t("配置")} onClick={() => setEditing({ row, isNew: false })}>
              <Settings size={12} />
            </button>
            <Toggle on={row.enabled} onChange={(v) => { void toggle(row, v); }} />
          </div>
        ))}
      </div>

      {editing && (
        <ServerDialog
          draft={editing.row}
          isNew={editing.isNew}
          onCancel={() => setEditing(null)}
          onSave={(row) => { void save(row); }}
          onDelete={() => { void remove(editing.row); }}
        />
      )}
    </>
  );
}
