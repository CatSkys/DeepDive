// 引导第 2 步·模型：选提供方（与设置→模型同一份快捷厂商表）→ 填密钥 → 选默认模型。
//
// 落库两条（活引擎实测的契约，别简化）：
//  ① `credentials/set {ref}`——ref 按 `keyRefOf`（与设置页同一规则）；
//  ② `llm-pi-ai.providers.<id> = {apiKeyEnv}` —— **只写密钥不声明 profile，提供方
//     不会出现在模型目录里**（实测：写 KIMI_CODING_API_KEY 后目录仍只有 DeepSeek；
//     补上空 profile 立刻出现 4 个模型）。空 profile 服务引擎完整目录，所以这里
//     不写 models（写非空会整体替换该路由目录，PITFALLS §7.4）。DeepSeek official
//     是随包组合的，不需要 profile，只写密钥。
import { useEffect, useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { api } from "../../api";
import { useT } from "../../i18n";
import { keyRefOf } from "../../settings/ModelDialog";
import { probeProvider } from "../../settings/providerProbe";
import { useModelCatalog } from "../../settings/useModelCatalog";
import { writeNamespaceOnce } from "../../settings/useSettingNamespace";
import { QUICK_ADD_PROVIDERS, providerLabel } from "../../settings/vendors";
import type { ModelOption } from "../../components/ModelMenu";
import css from "../OnboardingWizard.module.css";

const DEEPSEEK = "deepseek-official";

export function ModelStep() {
  const { t, tt } = useT();
  const cat = useModelCatalog();
  const [provider, setProvider] = useState<string>(DEEPSEEK);
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<ModelOption[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedDefault, setSavedDefault] = useState(false);

  const ref = keyRefOf(provider, cat.deepseek.apiKeyEnv);
  const configured = cat.credentials[ref] === true;

  // 该提供方在引擎目录里的模型（声明 + 密钥齐了才有）。
  const providerModels = useMemo(() => options.filter((o) => o.provider === provider), [options, provider]);

  useEffect(() => {
    if (!configured) return;
    void api.modelOptions().then(({ options: list, default: def }) => {
      setOptions(list);
      const own = list.filter((o) => o.provider === provider);
      const hit = def && def.provider === provider ? `${def.provider}|${def.model}` : null;
      setPicked(hit ?? (own[0] ? `${own[0].provider}|${own[0].model}` : null));
    }).catch(() => setOptions([]));
  }, [configured, provider]);

  const saveKey = async () => {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      await api.credentialsSet({ ref, value: key.trim() });
      if (provider !== DEEPSEEK) {
        // 声明 profile（空壳）：不写它，提供方不会出现在模型目录里。
        await writeNamespaceOnce(
          "llm-pi-ai",
          tt("引擎未提供 llm-pi-ai 命名空间，无法添加提供方", "The engine exposes no llm-pi-ai namespace; cannot add the provider"),
          async (entry) => {
            const current = (entry.value ?? {}) as { providers?: Record<string, unknown> };
            await api.settingsUpdate({
              ns: "llm-pi-ai",
              patch: {
                ...current,
                providers: { ...(current.providers ?? {}), [provider]: { apiKeyEnv: ref } },
              },
              expectedRevision: entry.revision,
            });
          },
        );
      }
      const result = await probeProvider({ provider, deepseekApiKeyEnv: cat.deepseek.apiKeyEnv });
      if (!result.ok) { setError(result.message); return; }
      setNotice(result.message);
      await cat.reload();
      const { options: list, default: def } = await api.modelOptions();
      setOptions(list);
      const own = list.filter((o) => o.provider === provider);
      const hit = def && def.provider === provider ? `${def.provider}|${def.model}` : null;
      setPicked(hit ?? (own[0] ? `${own[0].provider}|${own[0].model}` : null));
    } catch (err) {
      setError((err as Error).message.slice(0, 200));
    }
    setTesting(false);
  };

  const saveDefault = async () => {
    const hit = options.find((o) => `${o.provider}|${o.model}` === picked);
    if (!hit) return;
    setSaving(true);
    setError(null);
    try {
      await writeNamespaceOnce(
        "agent-default-model",
        tt("引擎未提供默认模型命名空间，无法保存", "The engine exposes no default-model namespace; cannot save"),
        async (entry) => {
          const value = (entry.value ?? {}) as { reasoningEffort?: string };
          await api.settingsUpdate({
            ns: "agent-default-model",
            patch: {
              ...value,
              provider: hit.provider,
              model: hit.model,
              ...(hit.defaultEffort ?? value.reasoningEffort ? { reasoningEffort: hit.defaultEffort ?? value.reasoningEffort } : {}),
            },
            expectedRevision: entry.revision,
          });
        },
      );
      setSavedDefault(true);
    } catch (err) {
      setError((err as Error).message.slice(0, 200));
    }
    setSaving(false);
  };

  return (
    <div className={css.step}>
      <div className={css.stepTitle}>{t("配置模型")}</div>
      <div className={css.stepLead}>
        {t("选一家模型服务、填入 API Key 就能开始；自定义端点在设置 → 模型里加。")}
      </div>

      <div className={css.groupLabel}>{t("提供方")}</div>
      <div className={css.chips}>
        {QUICK_ADD_PROVIDERS.map((id) => {
          const vendorRef = keyRefOf(id, cat.deepseek.apiKeyEnv);
          const done = cat.credentials[vendorRef] === true;
          const name = cat.providers.find((p) => p.provider === id)?.displayName ?? id;
          return (
            <button
              key={id}
              type="button"
              className={id === provider ? `${css.chip} ${css.chipOn}` : css.chip}
              onClick={() => { setProvider(id); setKey(""); setNotice(null); setError(null); setSavedDefault(false); }}
            >
              {providerLabel(id, name)}
              {done && <Check size={12} />}
            </button>
          );
        })}
      </div>

      <label className={css.fieldLabel} htmlFor="onboarding-key">
        {tt("{p} 的 API Key", "{p} API key", { p: providerLabel(provider, provider) })}
      </label>
      <input
        id="onboarding-key"
        className={css.field}
        type="password"
        value={key}
        autoComplete="off"
        placeholder={configured ? t("已配置 —— 留空保持不变") : "sk-…"}
        onChange={(e) => setKey(e.target.value)}
      />
      <div className={css.actions}>
        <button type="button" className={css.primary} disabled={testing || key.trim().length === 0} onClick={() => void saveKey()}>
          {testing ? <><Loader2 size={14} className={css.spin} />{t("测试中…")}</> : t("保存并测试")}
        </button>
      </div>
      {notice && !error && <div className={css.ok}><Check size={13} />{notice}</div>}

      {configured && (
        <>
          <div className={css.groupLabel}>{t("默认模型")}</div>
          {providerModels.length === 0 ? (
            <div className={css.empty}>{t("引擎目录里还没有这家的模型。")}</div>
          ) : (
            <ul className={css.rows}>
              {providerModels.slice(0, 12).map((o) => {
                const id = `${o.provider}|${o.model}`;
                return (
                  <li key={id}>
                    <label className={css.radioRow}>
                      <input
                        type="radio"
                        name="onboarding-model"
                        checked={picked === id}
                        onChange={() => { setPicked(id); setSavedDefault(false); }}
                      />
                      <span className={css.rowName}>{o.label}</span>
                      <span className={css.rowMeta}>{o.providerLabel}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {!savedDefault && (
            <div className={css.actions}>
              <button type="button" className={css.secondary} disabled={saving || !picked} onClick={() => void saveDefault()}>
                {saving ? t("保存中…") : t("设为默认模型")}
              </button>
            </div>
          )}
        </>
      )}

      {error && <div className={css.error}>{error}</div>}
    </div>
  );
}
