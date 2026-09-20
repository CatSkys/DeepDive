// 引导第 2 步·模型：选提供方（与设置→模型同一份快捷厂商表，带厂商图标）→ 填密钥 →
// 选默认模型。模型清单**全量展示**（不截断）：非 DeepSeek 优先用发现接口的端点实况
//（`llm/discoverModels`，即设置页"测试连通"报的那个数），失败或 DeepSeek（无发现路由）
// 再回落到引擎目录。
//
// 落库两条（活引擎实测的契约，别简化）：
//  ① `credentials/set {ref}`——ref 按 `keyRefOf`（与设置页同一规则）；
//  ② `llm-pi-ai.providers.<id> = {apiKeyEnv, headers?}` —— **只写密钥不声明 profile，
//     提供方不会出现在模型目录里**（实测：写 KIMI_CODING_API_KEY 后目录仍只有 DeepSeek；
//     补上空 profile 立刻出现 4 个模型）。这里只补密钥声明与该端点的会话头，profile
//     其余字段（models 清单等）原样带过：不写 models 是本步的规矩（写非空会整体替换
//     该路由目录，PITFALLS §7.4），但别处的声明也不能被这一次保存抹掉。DeepSeek
//     official 是随包组合的，不需要 profile，只写密钥。
import { useEffect, useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";
import { api } from "../../api";
import { useT } from "../../i18n";
import { CUSTOM_PROVIDER, ModelDialog, keyRefOf, sessionHeaders, type PiProviderProfile } from "../../settings/ModelDialog";
import { probeProvider } from "../../settings/providerProbe";
import { useOnboardingCatalog } from "../catalog";
import { writeNamespaceOnce } from "../../settings/useSettingNamespace";
import { PICKER_EXCLUDED_PROVIDERS, QUICK_ADD_PROVIDERS, providerLabel } from "../../settings/vendors";
import { ProviderIcon } from "../../components/ProviderIcon";
import css from "../OnboardingWizard.module.css";

const DEEPSEEK = "deepseek-official";

/** 条目错落入场（同迁移步）。 */
const rowStyle = (index: number) => ({ animationDelay: `${Math.min(index, 12) * 20}ms` });

/** 展示用的一行模型（来源可能是发现接口或引擎目录，字段归一到这里）。 */
interface ModelRow {
  id: string;
  label: string;
  note?: string;
}

export function ModelStep() {
  const { t, tt } = useT();
  const cat = useOnboardingCatalog();
  const [provider, setProvider] = useState<string>(DEEPSEEK);
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);

  const ref = keyRefOf(provider, cat.deepseek.apiKeyEnv);
  const configured = cat.credentials[ref] === true;
  // chip = 快捷厂商 + 其他已声明的提供方（自定义加的、迁移导入的都在这里出现，
  // 否则那些提供方在引导里根本选不到）；挑选入口排除表（PICKER_EXCLUDED_PROVIDERS）
  // 里的提供方即使已配密钥也不出现——它的入口已收敛到另一条端点。
  const extraProviders = Object.keys(cat.pi.providers).filter(
    (id) => !QUICK_ADD_PROVIDERS.includes(id) && !PICKER_EXCLUDED_PROVIDERS.includes(id),
  );

  // 该提供方的模型清单：发现接口优先（端点实况），回落到引擎目录。
  useEffect(() => {
    if (!configured) { setRows([]); setPicked(null); return; }
    let alive = true;
    (async () => {
      if (provider !== DEEPSEEK) {
        const discovered = await api.discoverModels({ settingsNs: "llm-pi-ai", provider }).catch(() => null);
        if (!alive) return;
        if (discovered && discovered.length > 0) {
          setRows(discovered.map((m) => ({
            id: m.id,
            label: m.name ?? m.id,
            ...(typeof m.contextWindow === "number" ? { note: `${Math.round(m.contextWindow / 1000)}K` } : {}),
          })));
          return;
        }
      }
      const { options: list } = await api.modelOptions().catch(() => ({ options: [] }));
      if (!alive) return;
      setRows(list.filter((o) => o.provider === provider).map((o) => ({ id: o.model, label: o.label, note: o.providerLabel })));
    })();
    return () => { alive = false; };
  }, [configured, provider]);

  // 默认选中：引擎当前默认（若就是这家）→ 否则第一个。
  useEffect(() => {
    if (rows.length === 0) return;
    setPicked((cur) => (cur && rows.some((r) => r.id === cur) ? cur : rows[0].id));
  }, [rows]);

  const saveKey = async () => {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      await api.credentialsSet({ ref, value: key.trim() });
      if (provider !== DEEPSEEK) {
        // 声明 profile：不写它，提供方不会出现在模型目录里。原有的 profile **原样
        // 带过**（models 清单、会话头都是别处落下的路由事实），只补密钥声明与
        // 该端点的会话头。
        await writeNamespaceOnce(
          "llm-pi-ai",
          tt("引擎未提供 llm-pi-ai 命名空间，无法添加提供方", "The engine exposes no llm-pi-ai namespace; cannot add the provider"),
          async (entry) => {
            const current = (entry.value ?? {}) as { providers?: Record<string, PiProviderProfile> };
            const prev = current.providers?.[provider];
            const headers = sessionHeaders(provider, prev?.headers);
            await api.settingsUpdate({
              ns: "llm-pi-ai",
              patch: {
                ...current,
                providers: {
                  ...(current.providers ?? {}),
                  [provider]: {
                    ...prev,
                    apiKeyEnv: ref,
                    ...(headers === undefined ? {} : { headers }),
                  },
                },
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
    } catch (err) {
      setError((err as Error).message.slice(0, 200));
    }
    setTesting(false);
  };

  /** 清除已保存的密钥（填进去就要能撤）。设置页那套「删除提供方」还连带摘 profile，
      这里只清密钥：profile 是路由声明，留着无害（没有密钥的提供方不会进目录）。 */
  const clearKey = async () => {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      await api.credentialsUnset({ ref });
      await cat.reload();
      setNotice(t("已清除密钥"));
    } catch (err) {
      setError((err as Error).message.slice(0, 200));
    }
    setTesting(false);
  };

  /** 选中即落默认：单选本身就是决定（不再有按钮，也不再多一句话提示）。 */
  const saveDefaultFor = async (modelId: string) => {
    setError(null);
    try {
      await writeNamespaceOnce(
        "agent-default-model",
        tt("引擎未提供默认模型命名空间，无法保存", "The engine exposes no default-model namespace; cannot save"),
        async (entry) => {
          const value = (entry.value ?? {}) as { reasoningEffort?: string };
          await api.settingsUpdate({
            ns: "agent-default-model",
            patch: { ...value, provider, model: modelId },
            expectedRevision: entry.revision,
          });
        },
      );
    } catch (err) {
      setError((err as Error).message.slice(0, 200));
    }
  };

  return (
    <div className={css.step}>
      <div className={css.stepTitle}>{t("配置模型")}</div>
      <div className={css.stepLead}>
        {t("选一家模型服务、填入 API Key 就能开始；自定义端点在设置 → 模型里加。")}
      </div>

      <div className={css.groupLabel}>{t("提供方")}</div>
      <div className={css.chips}>
        {QUICK_ADD_PROVIDERS.map((id, i) => {
          const vendorRef = keyRefOf(id, cat.deepseek.apiKeyEnv);
          const done = cat.credentials[vendorRef] === true;
          const name = cat.providers.find((p) => p.provider === id)?.displayName ?? id;
          return (
            <button
              key={id}
              type="button"
              className={id === provider ? `${css.chip} ${css.chipOn} ${css.rowIn}` : `${css.chip} ${css.rowIn}`}
              style={rowStyle(i)}
              onClick={() => { setProvider(id); setKey(""); setNotice(null); setError(null); }}
            >
              <ProviderIcon provider={id} size={15} />
              {providerLabel(id, name)}
              {done && <Check size={12} />}
            </button>
          );
        })}
        {extraProviders.map((id) => {
          const extraRef = keyRefOf(id, cat.deepseek.apiKeyEnv);
          const done = cat.credentials[extraRef] === true;
          const profile = cat.pi.providers[id] as { displayName?: string } | undefined;
          return (
            <button
              key={id}
              type="button"
              className={id === provider ? `${css.chip} ${css.chipOn}` : css.chip}
              onClick={() => { setProvider(id); setKey(""); setNotice(null); setError(null); }}
            >
              <ProviderIcon provider={id} size={15} />
              {providerLabel(id, profile?.displayName ?? id)}
              {done && <Check size={12} />}
            </button>
          );
        })}
        <button type="button" className={`${css.chip} ${css.chipGhost}`} onClick={() => setCustomOpen(true)}>
          <Plus size={14} />{t("自定义提供方…")}
        </button>
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
        {configured && (
          <button type="button" className={css.secondary} disabled={testing} onClick={() => void clearKey()}>
            {t("清除密钥")}
          </button>
        )}
        {notice && !error && <span className={css.ok}><Check size={13} />{notice}</span>}
      </div>

      {configured && (
        <>
          <div className={css.groupHead}>
            <span className={css.groupLabel}>{t("默认模型")}</span>
            <span className={css.rowMeta}>{tt("{n} 个模型", "{n} models", { n: rows.length })}</span>
          </div>
          {rows.length === 0 ? (
            <div className={css.empty}>{t("还没拿到这家的模型清单。")}</div>
          ) : (
            <ul className={`${css.rows} ${css.rowsTall}`}>
              {rows.map((row, i) => (
                <li key={row.id} className={css.rowIn} style={rowStyle(i)}>
                  <label className={css.radioRow}>
                    <input
                      className={css.native}
                      type="radio"
                      name="onboarding-model"
                      checked={picked === row.id}
                      onChange={() => {
                        setPicked(row.id);
                        setError(null);
                        void saveDefaultFor(row.id);
                      }}
                    />
                    <span className={css.dot} aria-hidden="true" />
                    <span className={css.rowName}>{row.label}</span>
                    {row.note && <span className={css.rowMeta}>{row.note}</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {error && <div className={css.error}>{error}</div>}

      {customOpen && (
        <ModelDialog
          providers={cat.providers}
          deepseek={cat.deepseek}
          pi={cat.pi}
          piProtocols={cat.piProtocols}
          edit={null}
          initialProvider={CUSTOM_PROVIDER}
          credentials={cat.credentials}
          onDone={() => { setCustomOpen(false); void cat.reload(); }}
          onCancel={() => setCustomOpen(false)}
        />
      )}
    </div>
  );
}
