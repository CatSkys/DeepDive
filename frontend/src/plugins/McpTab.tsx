// 插件页「MCP」tab：MCP server 的列表、启停与增删改。
//
// 一个 server 一行 `@deepseek-ai/dsh-mcp-client` 插进 profile 装配树：配置源是壳的
// JSON（`<support>/mcp-servers.json`），patch 块由壳生成 —— 引擎 `patchReload: live`
// 热重载，所以增删改与启停都不重启进程。模型侧工具名是 `mcp__<serverName>__<tool>`。
//
// 密钥：MCP client 的挂载形状是 `env: {TOKEN: !!js process.env.X}`，值**只能来自引擎
// 进程的环境变量**。所以密钥由壳存进密钥表（0600）并在 spawn 引擎时注入，patch 文件里
// 只留变量名这个引用。前端只拿到"哪些 key 已配置"（不回值，与模型 Key 同一条惯例）。
//
// 行状态取自 `pluginInventory`：每个 server 是独立的一行（`include:mcp-<名字>`），
// 所以它的 fiberPhase 真实反映**这个 server** 的挂载成败（命令不存在 → failed）。

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Settings, Trash2 } from "lucide-react";
import { Toggle } from "../components/controls";
import { GlassLayer } from "../components/GlassLayer";
import { alertDialog, confirmDialog } from "../components/DialogHost";
import { api, type McpServerRow } from "../api";
import { useT } from "../i18n";
import rs from "../settings/SettingsRows.module.css";
import css from "./Plugins.module.css";

/** 空草稿：新增时的起点。 */
function blankServer(): McpServerRow {
  return { rowId: "", name: "", transport: "stdio", command: "", args: [], url: "", env: [], headers: [], enabled: true };
}

/** 「每行 KEY=VALUE」→ 表；没有 `=` 的行忽略（不是密钥就不猜）。 */
function parseSecretLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

const splitNames = (text: string) => text.split(/[,\s]+/).map((s) => s.trim()).filter((s) => s.length > 0);

/** 编辑弹窗：字段用 grid 排（PITFALLS §1.6：不要用 flex 子项嵌百分比宽表单控件）。 */
function ServerDialog({ draft, isNew, configured, onCancel, onSave, onDelete }: {
  draft: McpServerRow;
  isNew: boolean;
  /** 该 server 已配置的密钥 key 名（壳不回值）。 */
  configured: string[];
  onCancel: () => void;
  onSave: (row: McpServerRow, secrets: Record<string, string>) => void;
  onDelete: () => void;
}) {
  const { t, tt } = useT();
  const [row, setRow] = useState<McpServerRow>(draft);
  const [envText, setEnvText] = useState((draft.env.length > 0 ? draft.env : draft.headers).join(", "));
  const [secretText, setSecretText] = useState("");
  const patch = (next: Partial<McpServerRow>) => setRow((prev) => ({ ...prev, ...next }));
  const isHttp = row.transport === "streamable-http";

  return (
    <div className="dialog-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dialog-card" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
        <GlassLayer />
        <div className="dialog-title">{isNew ? t("添加 MCP 服务器") : t("编辑 MCP 服务器")}</div>
        <div className={css.form}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t("名字")}</span>
            <input className="dialog-input" autoFocus value={row.name} onChange={(e) => patch({ name: e.target.value })} />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t("传输")}</span>
            <select
              className="dialog-input"
              value={row.transport}
              onChange={(e) => patch({ transport: e.target.value === "streamable-http" ? "streamable-http" : "stdio" })}
            >
              <option value="stdio">stdio</option>
              <option value="streamable-http">streamable-http</option>
            </select>
          </label>
          {isHttp ? (
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
                  onChange={(e) => patch({ args: splitNames(e.target.value) })}
                />
              </label>
            </>
          )}
          <label className={css.field}>
            <span className={css.fieldLabel}>{isHttp ? t("请求头名（逗号分隔）") : t("环境变量名（逗号分隔）")}</span>
            <input
              className="dialog-input"
              value={envText}
              placeholder={isHttp ? "Authorization" : "GITHUB_TOKEN"}
              onChange={(e) => {
                setEnvText(e.target.value);
                patch(isHttp ? { headers: splitNames(e.target.value) } : { env: splitNames(e.target.value) });
              }}
            />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t("密钥（每行 KEY=VALUE；留空表示不改动已有）")}</span>
            <textarea
              className="dialog-input"
              rows={3}
              value={secretText}
              placeholder={configured.length > 0 ? configured.map((k) => `${k}=…`).join("\n") : "GITHUB_TOKEN=ghp_xxx"}
              onChange={(e) => setSecretText(e.target.value)}
            />
          </label>
          <div className={css.formNote}>
            {configured.length > 0
              ? tt(
                "已配置：{keys}。密钥存在本机密钥表里，不写进 patch 文件。",
                "Configured: {keys}. Secrets live in this machine's key store, never in the patch file.",
                { keys: configured.join("、") },
              )
              : t("密钥由壳存进本机密钥表、启动引擎时注入环境变量；patch 文件里只留变量名这个引用。")}
          </div>
        </div>
        <div className="dialog-actions">
          {!isNew && (
            <button type="button" className="dialog-btn danger" onClick={onDelete}>
              <Trash2 size={12} /> {t("删除")}
            </button>
          )}
          <button type="button" className="dialog-btn" onClick={onCancel}>{t("取消")}</button>
          <button type="button" className="dialog-btn primary" onClick={() => onSave(row, parseSecretLines(secretText))}>
            {t("保存")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function McpTab({ query }: { query: string }) {
  const { t, tt } = useT();
  const [servers, setServers] = useState<McpServerRow[] | null>(null);
  const [configured, setConfigured] = useState<Record<string, string[]>>({});
  const [phases, setPhases] = useState<Record<string, string | null>>({});
  const [editing, setEditing] = useState<{ row: McpServerRow; isNew: boolean } | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(() => {
    // 配置源与密钥都在引擎里（`pluginInventory/mcpList`），浏览器访问同样可用
    void api.mcpList().then((store) => { setServers(store.servers); setConfigured(store.configured); })
      // 引擎未就绪、或这个引擎没有这组方法：说清楚，不冒充"没有服务器"
      .catch(() => { setUnavailable(true); setServers([]); setConfigured({}); });
    // 每行是独立插件（`include:mcp-<名字>`），它的 fiberPhase 就是该 server 的挂载成败
    void api.pluginInventory()
      .then((snap) => {
        const map: Record<string, string | null> = {};
        for (const entry of snap.entries) {
          if (entry.entryId.startsWith("include:mcp-")) {
            map[entry.entryId.slice("include:".length)] = entry.fiberPhase;
          }
        }
        setPhases(map);
      })
      .catch(() => setPhases({}));
  }, []);
  useEffect(load, [load]);

  const persist = async (next: McpServerRow[], secrets: Record<string, Record<string, string>>): Promise<boolean> => {
    try {
      await api.mcpSave(next, secrets);
    } catch (error: unknown) {
      // 引擎的拒绝码（mcp/invalid）与存储故障都带原因，直接说给用户
      const message = (error as { engineMessage?: string }).engineMessage ?? (error as Error).message;
      await alertDialog({ message });
      return false;
    }
    setServers(next);
    // 引擎热重载有一拍延迟：等它应用完再拉状态
    window.setTimeout(load, 1500);
    return true;
  };

  const toggle = async (row: McpServerRow, on: boolean) => {
    await persist((servers ?? []).map((s) => (s.rowId === row.rowId ? { ...s, enabled: on } : s)), {});
  };

  const save = async (draft: McpServerRow, secrets: Record<string, string>) => {
    const rows = servers ?? [];
    const exists = rows.some((s) => s.rowId === draft.rowId);
    const next = exists ? rows.map((s) => (s.rowId === draft.rowId ? draft : s)) : [...rows, draft];
    const secretPayload = Object.keys(secrets).length > 0 ? { [draft.name]: secrets } : {};
    if (await persist(next, secretPayload)) setEditing(null);
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
    if (await persist((servers ?? []).filter((s) => s.rowId !== row.rowId), {})) setEditing(null);
  };

  /** 该行当前的挂载状态文案（没有数据就不显示，不编造）。 */
  const stateOf = useMemo(() => (row: McpServerRow): string => {
    if (!row.enabled) return t("已停用");
    const phase = phases[row.rowId];
    if (phase === "active") return t("已挂载");
    if (phase === "failed") return t("启动失败");
    return "";
  }, [phases, t]);

  const needle = query.trim().toLocaleLowerCase();
  const visible = (servers ?? []).filter((s) => needle.length === 0 || s.name.toLocaleLowerCase().includes(needle));

  return (
    <>
      <div className={css.groupHead}>
        <div className={css.groupLabel}>{t("服务器")}</div>
        <button className={rs.secondaryButton} onClick={() => setEditing({ row: blankServer(), isNew: true })} disabled={unavailable}>
          <Plus size={12} /> {t("添加")}
        </button>
      </div>
      <div className={rs.blockCard}>
        {unavailable && (
          <div className={rs.blockRow}>
            <span className={rs.muted}>{t("引擎未连接，或这个版本的引擎没有 MCP 接口（配置与密钥都在引擎侧）。")}</span>
          </div>
        )}
        {!unavailable && servers !== null && servers.length === 0 && (
          <div className={rs.blockRow}>
            <span className={rs.muted}>{t("还没有 MCP 服务器。添加一个，它的工具会以 mcp__<名字>__<工具> 出现在模型手里。")}</span>
          </div>
        )}
        {!unavailable && servers !== null && servers.length > 0 && visible.length === 0 && (
          <div className={rs.blockRow}>
            <span className={rs.muted}>{t("没有匹配的服务器。")}</span>
          </div>
        )}
        {visible.map((row) => (
          <div key={row.rowId} className={rs.blockRow}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className={rs.rowName}>{row.name}</div>
              <div className={css.rowMeta}>
                {row.transport === "streamable-http" ? row.url : [row.command, ...row.args].join(" ")}
              </div>
            </div>
            {stateOf(row) !== "" && <span className={rs.muted}>{stateOf(row)}</span>}
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
          configured={editing.isNew ? [] : (configured[editing.row.name] ?? [])}
          onCancel={() => setEditing(null)}
          onSave={(row, secrets) => { void save(row, secrets); }}
          onDelete={() => { void remove(editing.row); }}
        />
      )}
    </>
  );
}
