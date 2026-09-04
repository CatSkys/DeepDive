import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { useT } from "../i18n";
import { ProviderIcon } from "../components/ProviderIcon";
import {
  ModelDialog, keyRefOf, updateDeepseekModels, updatePiProviders,
  type DeepseekNs, type EditTarget, type PiNs, type PiProviderProfile, type ProviderInfo,
} from "./ModelDialog";
import cssRows from "./SettingsRows.module.css";

// 模型设置（参考 WorkBuddy 版式重构）：不再平铺全部提供方——只列「已保存
// 模型」（即会话头部选择器的数据源 llm.models），增删改走 ModelDialog 弹窗。
// 删除语义按落点分流：目录内条目（deepseek / 已落盘自定义）删条目；引擎
// 声明目录行删提供方密钥（其模型随密钥整体从选择器移除）。

interface SavedRow {
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
  active: boolean;
  kind: "deepseek" | "pi";
  /** 该模型是否落在可编辑目录里（引擎声明目录行不在任何 settings 落点）。 */
  inDir: boolean;
}

export function ModelsManage() {
  const { t } = useT();
  const [rows, setRows] = useState<SavedRow[] | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [deepseek, setDeepseek] = useState<DeepseekNs>({ revision: undefined, apiKeyEnv: "DEEPSEEK_API_KEY", models: [] });
  const [pi, setPi] = useState<PiNs>({ revision: undefined, providers: {} });
  const [credentials, setCredentials] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<{ edit: EditTarget | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [opts, provs, d] = await Promise.all([
        api.modelOptions(),
        api.llmProviders().catch(() => ({ providers: [] as ProviderInfo[] })),
        api.settingsDescribe(),
      ]);
      const list = (provs.providers ?? []) as ProviderInfo[];
      setProviders(list);
      const deepNs = (d.namespaces ?? []).find((n) => n.ns === "llm-deepseek");
      const piNs = (d.namespaces ?? []).find((n) => n.ns === "llm-pi-ai");
      const deepVal = (deepNs?.value ?? {}) as { apiKeyEnv?: string; models?: { id: string; name?: string; contextWindow?: number }[] };
      const piVal = (piNs?.value ?? {}) as { providers?: Record<string, PiProviderProfile> };
      setDeepseek({ revision: deepNs?.revision, apiKeyEnv: deepVal.apiKeyEnv ?? "DEEPSEEK_API_KEY", models: deepVal.models ?? [] });
      setPi({ revision: piNs?.revision, providers: piVal.providers ?? {} });
      const providerMap = new Map(list.map((p) => [p.provider, p]));
      const seenProvider = new Set<string>();
      setRows(opts.options.map((o) => {
        const p = providerMap.get(o.provider);
        const kind = p?.settingsNs === "llm-deepseek" ? "deepseek" : "pi";
        const inDir = kind === "deepseek" || !!(piVal.providers ?? {})[o.provider]?.models?.some((m) => m.id === o.model);
        const first = !seenProvider.has(o.provider);
        seenProvider.add(o.provider);
        return {
          provider: o.provider,
          providerLabel: p?.displayName ?? o.providerLabel,
          model: o.model,
          label: o.label,
          active: !!p?.active && first,
          kind,
          inDir,
        };
      }));
      // 全部提供方的密钥配置状态（弹窗占位文案 + 编辑入口判定）
      const refs = list.map((p) => keyRefOf(p.provider, deepVal.apiKeyEnv ?? "DEEPSEEK_API_KEY"));
      try {
        const cr = await api.credentialsDescribe({ refs: [...new Set(refs)] });
        const configured: Record<string, boolean> = {};
        for (const [ref, c] of Object.entries(cr.credentials ?? {})) configured[ref] = !!c?.configured;
        setCredentials(configured);
      } catch { /* 引擎不可达：占位文案退化为「输入」 */ }
    } catch { setRows([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const remove = async (row: SavedRow) => {
    setNotice(null);
    try {
      if (row.inDir) {
        if (!window.confirm(t("删除模型「{m}」？").replace("{m}", row.label))) return;
        if (row.kind === "deepseek") {
          await updateDeepseekModels(deepseek.models.filter((m) => m.id !== row.model));
        } else {
          const prof = pi.providers[row.provider] ?? {};
          await updatePiProviders({
            ...pi.providers,
            [row.provider]: { ...prof, models: (prof.models ?? []).filter((m) => m.id !== row.model) },
          });
        }
      } else {
        if (!window.confirm(t("将清除「{p}」的 API 密钥，其全部模型将从选择器移除。").replace("{p}", row.providerLabel))) return;
        await api.credentialsUnset({ ref: keyRefOf(row.provider, deepseek.apiKeyEnv) });
      }
      await load();
    } catch (err) {
      setNotice(t("保存失败：{m}").replace("{m}", (err as Error).message));
    }
  };

  return (
    <div className={cssRows.section}>
      <div className={cssRows.mgmtCard}>
        <div className={cssRows.mgmtCardMain}>
          <div className={cssRows.mgmtCardTitle}>{t("本地配置文件")}</div>
          <div className={cssRows.mgmtCardDesc}>{t("提供方密钥与模型目录写入引擎 settings.yaml，保存即生效。")}</div>
        </div>
        <button className={cssRows.primaryButton} onClick={() => { setNotice(null); setDialog({ edit: null }); }}>
          <Plus size={13} /> {t("添加模型")}
        </button>
      </div>
      <div className={cssRows.sectionTitle}>{t("已保存模型")}</div>
      {rows === null && <div className={cssRows.muted}>{t("载入中…")}</div>}
      {rows !== null && rows.length === 0 && (
        <div className={cssRows.muted}>{t("暂无已保存模型——点上方「添加模型」配置提供方密钥。")}</div>
      )}
      {rows !== null && rows.map((r) => (
        <div key={`${r.provider}-${r.model}`} className={cssRows.rowCard}>
          <div className={cssRows.modelRowIcon}><ProviderIcon provider={r.provider} size={16} /></div>
          <div className={cssRows.rowIdentity}>
            <div className={cssRows.rowName} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {r.label}
              {r.active && (
                <span className={cssRows.badge}>
                  <span className={`${cssRows.badgeDot} ${cssRows.on}`} />
                  <span className={`${cssRows.badgeText} ${cssRows.on}`}>{t("当前使用")}</span>
                </span>
              )}
            </div>
            <div className={cssRows.rowCaption}>{r.providerLabel}</div>
          </div>
          <div className={cssRows.rowActions}>
            <button className={cssRows.iconBtn} onClick={() => setDialog({ edit: { provider: r.provider, kind: r.kind, origId: r.inDir ? r.model : undefined } })} aria-label={t("编辑")}>
              <Pencil size={14} />
            </button>
            <button className={cssRows.iconBtn} data-danger="true" onClick={() => void remove(r)} aria-label={t("删除")}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
      {notice && <div className={cssRows.modelError}>{notice}</div>}
      {dialog && (
        <ModelDialog
          providers={providers}
          deepseek={deepseek}
          pi={pi}
          edit={dialog.edit}
          credentials={credentials}
          onDone={() => { setDialog(null); void load(); }}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
