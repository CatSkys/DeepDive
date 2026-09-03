import { useCallback, useEffect, useState } from "react";
import { api, SettingsDescribe, SettingsNamespaceEntry } from "../api";
import { t, tt, useT } from "../i18n";
import cssRows from "./SettingsRows.module.css";

// 插件可配置项（5.6，官方 ui-settings-plugins 的 Bash/AgentLoop/WebSearch 卡
// 同构）：每张卡绑定一个设置命名空间，字段=命名空间值的标量子路径。
// 写入走 settings.update（整值 patch + expectedRevision 围栏）。

interface FieldSpec {
  key: string;
  zh: string;
  en: string;
  kind: "number" | "text";
}

interface CardSpec {
  ns: string;
  title: [string, string];
  fields: FieldSpec[];
  /** 命名空间含密钥路径时展示凭据写入（web-search-deepseek 的 apiKey）。 */
  secretPath?: string[];
}

const CARDS: CardSpec[] = [
  {
    ns: "shell",
    title: ["Bash 终端", "Bash terminal"],
    fields: [
      { key: "timeoutMs", zh: "默认超时（毫秒）", en: "Default timeout (ms)", kind: "number" },
      { key: "maxTimeoutMs", zh: "最大超时（毫秒）", en: "Max timeout (ms)", kind: "number" },
      { key: "maxOutputBytes", zh: "输出上限（字节）", en: "Output cap (bytes)", kind: "number" },
      { key: "graceMs", zh: "宽限期（毫秒）", en: "Grace (ms)", kind: "number" },
    ],
  },
  {
    ns: "agent-loop",
    title: ["Agent 循环", "Agent loop"],
    fields: [
      { key: "maxParallelToolCalls", zh: "工具最大并行数", en: "Max parallel tool calls", kind: "number" },
    ],
  },
  {
    ns: "web-search-deepseek",
    title: ["联网搜索", "Web search"],
    fields: [
      { key: "model", zh: "模型", en: "Model", kind: "text" },
      { key: "apiVersion", zh: "API 版本", en: "API version", kind: "text" },
      { key: "maxTokens", zh: "maxTokens", en: "maxTokens", kind: "number" },
      { key: "maxUses", zh: "每轮调用上限", en: "Max uses per turn", kind: "number" },
    ],
    secretPath: ["apiKey"],
  },
];

export function PluginConfigCards() {
  const [namespaces, setNamespaces] = useState<SettingsNamespaceEntry[] | null>(null);
  const load = useCallback(async () => {
    try {
      const d: SettingsDescribe = await api.settingsDescribe();
      setNamespaces(d.namespaces ?? []);
    } catch { setNamespaces([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (namespaces === null) return <div className={cssRows.muted}>{t("载入中…")}</div>;
  const cards = CARDS.map((spec) => ({ spec, entry: namespaces.find((n) => n.ns === spec.ns) }))
    .filter((c): c is { spec: CardSpec; entry: SettingsNamespaceEntry } => !!c.entry);
  if (cards.length === 0) return <div className={cssRows.muted}>{t("本引擎未提供插件配置面。")}</div>;
  return (
    <>
      {cards.map(({ spec, entry }) => (
        <ConfigCard key={spec.ns} spec={spec} entry={entry} onSaved={load} />
      ))}
    </>
  );
}

function ConfigCard({ spec, entry, onSaved }: { spec: CardSpec; entry: SettingsNamespaceEntry; onSaved: () => Promise<void> }) {
  const { t } = useT();
  const value = (entry.value ?? {}) as Record<string, unknown>;
  const [draft, setDraft] = useState<Record<string, string | number | undefined>>(() => Object.fromEntries(spec.fields.map((f) => [f.key, value[f.key] as string | number | undefined])));
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = spec.fields.some((f) => draft[f.key] !== value[f.key]);
  const secretSet = (entry.secrets ?? []).find((s) => s.path.join(".") === (spec.secretPath ?? []).join("."))?.set;


  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = { ...value };
      for (const f of spec.fields) next[f.key] = draft[f.key];
      await api.settingsUpdate({ ns: spec.ns, patch: next, expectedRevision: entry.revision });
      if (spec.secretPath && secret.trim()) {
        await api.credentialsSet({ ref: String(value.apiKeyEnv ?? "DEEPSEEK_API_KEY"), value: secret.trim() });
      }
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className={cssRows.rowCard} style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
      <div className={cssRows.rowName}>{tt(...spec.title)}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {spec.fields.map((f) => (
          <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span className={cssRows.muted}>{tt(f.zh, f.en)}</span>
            <input
              className={cssRows.textField}
              value={draft[f.key] ?? ""}
              onChange={(e) => setDraft({ ...draft, [f.key]: f.kind === "number" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value })}
            />
          </label>
        ))}
        {spec.secretPath && (
          <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span className={cssRows.muted}>{t("API Key")}{secretSet ? t("（已配置）") : ""}</span>
            <input
              className={cssRows.textField}
              type="password"
              placeholder={secretSet ? "••••••" : "sk-…"}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>
        )}
      </div>
      {error && <div className={cssRows.muted}>{t("保存失败：{m}").replace("{m}", error)}</div>}
      {(dirty || (spec.secretPath && secret.trim())) && (
        <div style={{ display: "flex", gap: 8 }}>
          <button className={cssRows.primaryButton} disabled={busy} onClick={() => void save()}>{t("保存")}</button>
        </div>
      )}
    </div>
  );
}
