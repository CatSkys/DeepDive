import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Loader2, Pencil, Plug, Plus, Trash2, X } from "lucide-react";
import { api } from "../api";
import { tt, useT } from "../i18n";
import { ProviderIcon } from "../components/ProviderIcon";
import {
  ModelDialog, keyRefOf, updateDeepseekModels, updatePiProviders,
  type DeepseekNs, type EditTarget, type PiNs, type PiProviderProfile, type ProviderInfo,
} from "./ModelDialog";
import cssRows from "./SettingsRows.module.css";

// 模型设置（折叠卡片式）：按提供方聚类的可折叠分组，模型行展示 Meta
// （模态类型 / 推理 / 上下文窗口），增删改走 ModelDialog 弹窗。
// 数据源：llm.models（选择器分组 = 已保存模型，含 reasoning）+ settings
// 目录富化（contextWindow / inputModalities）+ llm.providers（显示名/active）。
// 删除语义按落点分流：目录条目删条目；引擎声明目录行清提供方密钥。

interface GroupModel {
  id: string;
  label: string;
  reasoning: boolean;
  contextWindow?: number;
  modalities?: string[];
  inDir: boolean;
}
interface ProviderGroup {
  provider: string;
  name: string;
  models: GroupModel[];
}

const MODALITY_LABEL: Record<string, string> = { text: "文本", image: "视觉", audio: "音频", video: "视频" };
/** 上下文窗口紧凑表示：1000000 → 1M，131072 → 131K */
const fmtContext = (n: number) => (n >= 1e6 ? `${Math.round((n / 1e6) * 10) / 10}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

export function ModelsManage() {
  const { t } = useT();
  const [groups, setGroups] = useState<ProviderGroup[] | null>(null);
  // 拉取失败 ≠ 空配置：失败时置消息、走失败文案，不冒充空态
  const [loadError, setLoadError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [deepseek, setDeepseek] = useState<DeepseekNs>({ apiKeyEnv: "DEEPSEEK_API_KEY", models: [] });
  const [pi, setPi] = useState<PiNs>({ providers: {} });
  const [credentials, setCredentials] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<{ edit: EditTarget | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testInfo, setTests] = useState<Record<string, { state: "testing" | "ok" | "fail"; msg: string }>>({});

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [llm, provs, d] = await Promise.all([
        api.llmModels().catch(() => ({ groups: [] as Array<{ id: string; name: string; models: Array<{ id: string; name?: string; reasoning?: { efforts?: unknown[] } }> }> })),
        api.llmProviders().catch(() => ({ providers: [] as ProviderInfo[] })),
        api.settingsDescribe(),
      ]);
      const list = (provs.providers ?? []) as ProviderInfo[];
      setProviders(list);
      const deepNs = (d.namespaces ?? []).find((n) => n.ns === "llm-deepseek");
      const piNs = (d.namespaces ?? []).find((n) => n.ns === "llm-pi-ai");
      const deepVal = (deepNs?.value ?? {}) as { apiKeyEnv?: string; models?: Array<{ id: string; name?: string; contextWindow?: number; inputModalities?: string[] }> };
      const piVal = (piNs?.value ?? {}) as { providers?: Record<string, PiProviderProfile> };
      setDeepseek({ apiKeyEnv: deepVal.apiKeyEnv ?? "DEEPSEEK_API_KEY", models: deepVal.models ?? [] });
      setPi({ providers: piVal.providers ?? {} });
      // Meta 富化表：provider|modelId → 上下文/模态（来自 settings 目录）
      const enrich = new Map<string, { contextWindow?: number; modalities?: string[] }>();
      for (const m of deepVal.models ?? []) {
        enrich.set(`deepseek-official|${m.id}`, { contextWindow: m.contextWindow, modalities: m.inputModalities });
      }
      for (const [pid, p] of Object.entries(piVal.providers ?? {})) {
        for (const m of p.models ?? []) enrich.set(`${pid}|${m.id}`, { contextWindow: m.contextWindow });
      }
      const providerMap = new Map(list.map((p) => [p.provider, p]));
      const built = (llm.groups ?? [])
        .filter((g) => (g.models ?? []).length > 0)
        .map((g) => {
          const p = providerMap.get(g.id);
          const models = (g.models ?? []).map((m) => {
            const en = enrich.get(`${g.id}|${m.id}`) ?? {};
            return {
              id: m.id,
              label: m.name || m.id,
              reasoning: !!m.reasoning?.efforts?.length,
              contextWindow: en.contextWindow,
              modalities: en.modalities,
              inDir: g.id === "deepseek-official" || !!(piVal.providers ?? {})[g.id]?.models?.some((x) => x.id === m.id),
            };
          });
          return {
            provider: g.id,
            name: p?.displayName || g.name || g.id,
            models,
          };
        });
      setGroups(built);
      // 全部提供方的密钥配置状态（弹窗占位文案）
      const refs = list.map((p) => keyRefOf(p.provider, deepVal.apiKeyEnv ?? "DEEPSEEK_API_KEY"));
      try {
        const cr = await api.credentialsDescribe({ refs: [...new Set(refs)] });
        const configured: Record<string, boolean> = {};
        for (const [ref, c] of Object.entries(cr.credentials ?? {})) configured[ref] = !!c?.configured;
        setCredentials(configured);
      } catch { /* 引擎不可达：占位文案退化为「输入」 */ }
    } catch (err) {
      setGroups([]);
      setLoadError(tt("读取失败：{m}", "Read failed: {m}", { m: (err as Error).message }));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  /** 连通测试：pi 提供方走发现接口（列出模型 = 连通且 Key 有效）；
      DeepSeek 无发现路由，退化为密钥配置状态检查。 */
  const test = async (row: { provider: string; id: string }) => {
    const key = `${row.provider}|${row.id}`;
    setTests((s0) => ({ ...s0, [key]: { state: "testing", msg: t("测试中…") } }));
    try {
      if (row.provider === "deepseek-official") {
        const ref = keyRefOf(row.provider, deepseek.apiKeyEnv);
        const cr = await api.credentialsDescribe({ refs: [ref] });
        const ok = !!cr.credentials?.[ref]?.configured;
        setTests((s0) => ({ ...s0, [key]: { state: ok ? "ok" : "fail", msg: ok ? t("密钥已配置") : t("未配置密钥") } }));
      } else {
        const r = await api.discoverModels({ settingsNs: "llm-pi-ai", provider: row.provider });
        setTests((s0) => ({ ...s0, [key]: { state: "ok", msg: tt("连通 · {n} 个模型", "Connected · {n} models", { n: (r.models ?? []).length }) } }));
      }
    } catch (err) {
      setTests((s0) => ({ ...s0, [key]: { state: "fail", msg: String((err as Error).message).slice(0, 140) } }));
    }
    setTimeout(() => setTests((s0) => {
      const next = { ...s0 };
      delete next[key];
      return next;
    }), 6000);
  };

  const remove = async (row: { provider: string; label: string; id: string; inDir: boolean }) => {
    setNotice(null);
    try {
      if (row.inDir) {
        if (!window.confirm(tt("删除模型「{m}」？", "Delete model \"{m}\"?", { m: row.label }))) return;
        if (row.provider === "deepseek-official") {
          await updateDeepseekModels(deepseek.models.filter((m) => m.id !== row.id));
        } else {
          const prof = pi.providers[row.provider] ?? {};
          await updatePiProviders({
            ...pi.providers,
            [row.provider]: { ...prof, models: (prof.models ?? []).filter((m) => m.id !== row.id) },
          });
        }
      } else {
        if (!window.confirm(tt("将清除「{p}」的 API 密钥，其全部模型将从选择器移除。", "This clears the API key of \"{p}\"; all its models will leave the picker.", { p: row.label }))) return;
        await api.credentialsUnset({ ref: keyRefOf(row.provider, deepseek.apiKeyEnv) });
      }
      await load();
    } catch (err) {
      setNotice(tt("保存失败：{m}", "Save failed: {m}", { m: (err as Error).message }));
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
      <div className={`${cssRows.sectionTitle} ${cssRows.savedTitle}`}>{t("已保存模型")}</div>
      {groups === null && <div className={cssRows.muted}>{t("载入中…")}</div>}
      {loadError && <div className={cssRows.modelError}>{loadError}</div>}
      {groups !== null && groups.length === 0 && !loadError && (
        <div className={cssRows.muted}>{t("暂无已保存模型——点上方「添加模型」配置提供方密钥。")}</div>
      )}
      {groups !== null && groups.map((g) => {
        const isCollapsed = !!collapsed[g.provider];
        return (
          <div key={g.provider} className={cssRows.modelGroup}>
            <button
              type="button"
              className={cssRows.modelGroupHead}
              aria-expanded={!isCollapsed}
              onClick={() => setCollapsed((c) => ({ ...c, [g.provider]: !c[g.provider] }))}
            >
              <ProviderIcon provider={g.provider} size={17} />
              <span className={cssRows.modelGroupName}>{g.name}</span>
              <span className={cssRows.modelGroupCount}>{g.models.length}</span>
              <ChevronDown size={14} className={`${cssRows.modelGroupChevron}${isCollapsed ? ` ${cssRows.closed}` : ""}`} />
            </button>
            {!isCollapsed && g.models.map((m) => (
              <div key={m.id} className={cssRows.modelRow}>
                <div className={cssRows.modelRowMain}>
                  <div className={cssRows.rowName} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {m.label}
                    {m.reasoning && <span className={cssRows.metaTag}>{t("推理")}</span>}
                    {(m.modalities ?? []).map((mod) => (
                      <span key={mod} className={cssRows.metaTag}>{t(MODALITY_LABEL[mod] ?? mod)}</span>
                    ))}
                    {m.contextWindow ? <span className={cssRows.metaTag}>{fmtContext(m.contextWindow)}</span> : null}
                  </div>
                </div>
                <div className={cssRows.rowActions}>
                  <button
                    className={cssRows.iconBtn}
                    data-tip={testInfo[`${g.provider}|${m.id}`]?.msg ?? t("测试连通")}
                    aria-label={t("测试连通")}
                    onClick={() => void test({ provider: g.provider, id: m.id })}
                  >
                    {(() => {
                      const st = testInfo[`${g.provider}|${m.id}`]?.state;
                      if (st === "testing") return <Loader2 size={14} className={cssRows.spin} />;
                      if (st === "ok") return <Check size={14} className={cssRows.testOk} />;
                      if (st === "fail") return <X size={14} className={cssRows.testFail} />;
                      return <Plug size={14} />;
                    })()}
                  </button>
                  <button
                    className={cssRows.iconBtn}
                    aria-label={t("编辑")}
                    onClick={() => setDialog({ edit: { provider: g.provider, kind: g.provider === "deepseek-official" ? "deepseek" : "pi", origId: m.inDir ? m.id : undefined } })}
                  >
                    <Pencil size={14} />
                  </button>
                  <button className={cssRows.iconBtn} data-danger="true" aria-label={t("删除")} onClick={() => void remove({ provider: g.provider, label: m.label, id: m.id, inDir: m.inDir })}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        );
      })}
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
