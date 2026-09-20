// 引导第 2 步·模型：配置密钥（默认 DeepSeek official）→ 选一个默认模型。
// 落库全部走既有通道：密钥 `credentials/set`，默认模型 `settings.update`
// （ns `agent-default-model`，经 writeNamespaceOnce 的 revision 围栏）。
import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { api } from "../../api";
import { keyRefOf } from "../../settings/ModelDialog";
import { probeProvider } from "../../settings/providerProbe";
import { useModelCatalog } from "../../settings/useModelCatalog";
import { writeNamespaceOnce } from "../../settings/useSettingNamespace";
import type { ModelOption } from "../../components/ModelMenu";
import css from "../OnboardingWizard.module.css";
import { ArrowRight, Check, Loader2 } from "lucide-react";

const PROVIDER = "deepseek-official";

export function ModelStep({ onNext }: { onNext: () => void }) {
  const { t, tt } = useT();
  const cat = useModelCatalog();
  const ref = keyRefOf(PROVIDER, cat.deepseek.apiKeyEnv);
  const configured = cat.credentials[ref] === true || cat.anyConfigured;

  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [probeMessage, setProbeMessage] = useState<string | null>(null);
  const [options, setOptions] = useState<ModelOption[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedDefault, setSavedDefault] = useState(false);

  // 已有密钥（迁移步带进来的也算）→ 直接列出可选模型。
  useEffect(() => {
    if (!cat.anyConfigured) return;
    void api.modelOptions().then(({ options: list, default: def }) => {
      setOptions(list);
      setPicked(def ? `${def.provider}|${def.model}` : (list[0] ? `${list[0].provider}|${list[0].model}` : null));
    }).catch(() => setOptions([]));
  }, [cat.anyConfigured]);

  const saveKey = async () => {
    setTesting(true);
    setError(null);
    setProbeMessage(null);
    try {
      await api.credentialsSet({ ref, value: key.trim() });
      const result = await probeProvider({ provider: PROVIDER, deepseekApiKeyEnv: cat.deepseek.apiKeyEnv });
      setProbeMessage(result.message);
      if (!result.ok) { setError(result.message); return; }
      await cat.reload();
      const { options: list, default: def } = await api.modelOptions();
      setOptions(list);
      setPicked(def ? `${def.provider}|${def.model}` : (list[0] ? `${list[0].provider}|${list[0].model}` : null));
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
        {configured
          ? t("密钥已配置，选一个默认模型即可。")
          : t("填入 DeepSeek API Key 就能开始；其他提供方之后可以在设置里加。")}
      </div>

      {!configured && (
        <>
          <label className={css.fieldLabel} htmlFor="onboarding-key">{t("API Key")}</label>
          <input
            id="onboarding-key"
            className={css.field}
            type="password"
            value={key}
            autoComplete="off"
            placeholder="sk-…"
            onChange={(e) => setKey(e.target.value)}
          />
          <div className={css.actions}>
            <button type="button" className={css.primary} disabled={testing || key.trim().length === 0} onClick={() => void saveKey()}>
              {testing ? <><Loader2 size={14} className={css.spin} />{t("测试中…")}</> : t("保存并测试")}
            </button>
          </div>
          {probeMessage && !error && <div className={css.ok}><Check size={13} />{probeMessage}</div>}
        </>
      )}

      {configured && (
        <>
          <div className={css.groupLabel}>{t("默认模型")}</div>
          {options.length === 0 ? (
            <div className={css.empty}>{t("引擎没有返回可选模型。")}</div>
          ) : (
            <ul className={css.rows}>
              {options.slice(0, 12).map((o) => {
                const id = `${o.provider}|${o.model}`;
                return (
                  <li key={id}>
                    <label className={css.radioRow}>
                      <input type="radio" name="onboarding-model" checked={picked === id} onChange={() => { setPicked(id); setSavedDefault(false); }} />
                      <span className={css.rowName}>{o.label}</span>
                      <span className={css.rowMeta}>{o.providerLabel}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {error && <div className={css.error}>{error}</div>}
      <div className={css.actions}>
        {configured && !savedDefault && (
          <button type="button" className={css.secondary} disabled={saving || !picked} onClick={() => void saveDefault()}>
            {saving ? t("保存中…") : t("设为默认模型")}
          </button>
        )}
        <button type="button" className={css.primary} disabled={!configured} onClick={onNext}>
          {t("下一步")}<ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
