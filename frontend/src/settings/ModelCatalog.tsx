import { useCallback, useEffect, useState } from "react";
import { api, SettingsDescribe } from "../api";
import { t, useT } from "../i18n";
import cssRows from "./SettingsRows.module.css";

// 模型目录管理（5.5，官方 ui-settings-models 的可用面移植）：
// - DeepSeek 路由：llm-deepseek.models 清单编辑（增删条目）；
// - 自定义路由：llm-pi-ai.providers 对象图（displayName/api/baseURL/models），
//   经 llm.discoverModels 探测端点模型后并入。
// 写入全部走 settings.update + expectedRevision 围栏（GeneralSection 同款）。

interface ModelProfile { id: string; name?: string; contextWindow?: number }
interface PiProviderProfile {
  apiKeyEnv?: string;
  displayName?: string;
  api?: string;
  baseURL?: string;
  models?: ModelProfile[];
}

interface NsState {
  revision: unknown;
  deepseekModels: ModelProfile[];
  piProviders: Record<string, PiProviderProfile>;
}

export function ModelCatalog() {
  const [ns, setNs] = useState<NsState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d: SettingsDescribe = await api.settingsDescribe();
      const deep = (d.namespaces ?? []).find((n) => n.ns === "llm-deepseek");
      const pi = (d.namespaces ?? []).find((n) => n.ns === "llm-pi-ai");
      const deepVal = (deep?.value ?? {}) as { models?: ModelProfile[] };
      const piVal = (pi?.value ?? {}) as { providers?: Record<string, PiProviderProfile> };
      setNs({
        revision: pi?.revision,
        deepseekModels: deepVal.models ?? [],
        piProviders: piVal.providers ?? {},
      });
    } catch { setNs(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const savePiProviders = async (providers: Record<string, PiProviderProfile>) => {
    if (!ns) return;
    try {
      const d = await api.settingsDescribe();
      const pi = (d.namespaces ?? []).find((n) => n.ns === "llm-pi-ai");
      if (!pi) return;
      const base = (pi.value ?? {}) as Record<string, unknown>;
      await api.settingsUpdate({ ns: "llm-pi-ai", patch: { ...base, providers }, expectedRevision: pi.revision });
      setNotice(t("已保存"));
      await load();
    } catch (err) {
      setNotice(t("保存失败：{m}").replace("{m}", (err as Error).message));
    }
  };

  const saveDeepseekModels = async (models: ModelProfile[]) => {
    try {
      const d = await api.settingsDescribe();
      const deep = (d.namespaces ?? []).find((n) => n.ns === "llm-deepseek");
      if (!deep) return;
      const base = (deep.value ?? {}) as Record<string, unknown>;
      await api.settingsUpdate({ ns: "llm-deepseek", patch: { ...base, models }, expectedRevision: deep.revision });
      setNotice(t("已保存"));
      await load();
    } catch (err) {
      setNotice(t("保存失败：{m}").replace("{m}", (err as Error).message));
    }
  };

  if (!ns) return null;
  return (
    <>
      <DeepSeekModels models={ns.deepseekModels} onSave={saveDeepseekModels} notice={setNotice} />
      <PiProviders providers={ns.piProviders} onSave={savePiProviders} notice={setNotice} />
      {notice && <div className={cssRows.muted}>{notice}</div>}
    </>
  );
}

function DeepSeekModels({ models, onSave, notice }: {
  models: ModelProfile[];
  onSave: (m: ModelProfile[]) => Promise<void>;
  notice: (s: string | null) => void;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState(models);
  useEffect(() => setDraft(models), [models]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(models);
  return (
    <div className={cssRows.section} style={{ marginTop: 14 }}>
      <div className={cssRows.sectionTitle}>{t("DeepSeek 模型目录")}</div>
      {draft.map((m, i) => (
        <div key={`${m.id}-${i}`} className={cssRows.listRow}>
          <input
            className={cssRows.textField}
            style={{ width: 190 }}
            value={m.id}
            onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))}
          />
          <input
            className={cssRows.textField}
            style={{ width: 170 }}
            placeholder={t("名称")}
            value={m.name ?? ""}
            onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
          />
          <input
            className={cssRows.textField}
            style={{ width: 120 }}
            placeholder="contextWindow"
            value={m.contextWindow ?? ""}
            onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, contextWindow: e.target.value ? Number(e.target.value) : undefined } : x)))}
          />
          <button className={cssRows.dangerButton} onClick={() => setDraft(draft.filter((_, j) => j !== i))}>{t("删除")}</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className={cssRows.secondaryButton} onClick={() => setDraft([...draft, { id: "" }])}>{t("添加模型")}</button>
        {dirty && (
          <>
            <button className={cssRows.primaryButton} onClick={() => { void onSave(draft); notice(null); }}>{t("保存")}</button>
            <button className={cssRows.secondaryButton} onClick={() => setDraft(models)}>{t("取消")}</button>
          </>
        )}
      </div>
    </div>
  );
}

function PiProviders({ providers, onSave, notice }: {
  providers: Record<string, PiProviderProfile>;
  onSave: (p: Record<string, PiProviderProfile>) => Promise<void>;
  notice: (s: string | null) => void;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState(providers);
  const [discovering, setDiscovering] = useState<string | null>(null);
  useEffect(() => setDraft(providers), [providers]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(providers);
  const patch = (id: string, next: PiProviderProfile) => setDraft({ ...draft, [id]: next });

  const discover = async (id: string) => {
    const p = draft[id]!;
    setDiscovering(id);
    notice(null);
    try {
      const r = await api.discoverModels({ settingsNs: "llm-pi-ai", provider: id, baseURL: p.baseURL, api: p.api });
      const found: ModelProfile[] = (r.models ?? []).map((m) => ({ id: m.id, name: m.name, contextWindow: m.contextWindow }));
      setDraft({ ...draft, [id]: { ...p, models: found } });
    } catch (err) {
      notice(t("发现模型失败：{m}").replace("{m}", (err as Error).message));
    }
    setDiscovering(null);
  };

  return (
    <div className={cssRows.section} style={{ marginTop: 14 }}>
      <div className={cssRows.sectionTitle}>{t("自定义提供方")}</div>
      <div className={cssRows.sectionIntro}>{t("OpenAI 兼容路由：填 baseURL 与 API 协议，发现模型后保存即生效。")}</div>
      {Object.entries(draft).map(([id, p]) => (
        <div key={id} className={cssRows.rowCard} style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <div className={cssRows.rowName} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={cssRows.mono}>{id}</span>
            <input
              className={cssRows.textField}
              style={{ width: 150 }}
              placeholder={t("显示名")}
              value={p.displayName ?? ""}
              onChange={(e) => patch(id, { ...p, displayName: e.target.value })}
            />
            <button className={cssRows.dangerButton} onClick={() => { const next = { ...draft }; delete next[id]; setDraft(next); }}>{t("删除")}</button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className={cssRows.textField}
              style={{ flex: 1 }}
              placeholder="baseURL"
              value={p.baseURL ?? ""}
              onChange={(e) => patch(id, { ...p, baseURL: e.target.value })}
            />
            <input
              className={cssRows.textField}
              style={{ width: 130 }}
              placeholder={t("协议（openai 等）")}
              value={p.api ?? ""}
              onChange={(e) => patch(id, { ...p, api: e.target.value })}
            />
            <button className={cssRows.secondaryButton} disabled={discovering === id} onClick={() => void discover(id)}>
              {discovering === id ? t("载入中…") : t("发现模型")}
            </button>
          </div>
          <div className={cssRows.muted}>
            {(p.models ?? []).length > 0
              ? (p.models ?? []).map((m) => m.id).join(" · ")
              : t("未配置模型清单（可发现后并入）")}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          className={cssRows.secondaryButton}
          onClick={() => {
            const id = prompt(t("路由 ID（如 openrouter）"));
            if (!id || !id.trim() || draft[id.trim()]) return;
            setDraft({ ...draft, [id.trim()]: {} });
          }}
        >
          {t("添加提供方")}
        </button>
        {dirty && (
          <>
            <button className={cssRows.primaryButton} onClick={() => { void onSave(draft); notice(null); }}>{t("保存")}</button>
            <button className={cssRows.secondaryButton} onClick={() => setDraft(providers)}>{t("取消")}</button>
          </>
        )}
      </div>
    </div>
  );
}
