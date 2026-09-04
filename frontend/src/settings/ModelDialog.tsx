import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff, X } from "lucide-react";
import { api } from "../api";
import { t } from "../i18n";
import { ProviderIcon } from "../components/ProviderIcon";
import { Dropdown } from "./controls";
import cssRows from "./SettingsRows.module.css";

// 添加/编辑模型弹窗（参考 WorkBuddy 模型设置版式）：提供商 + API Key + 模型
// 三段式渐进表单。数据契约沿用现有路由——密钥走 credentials.set，DeepSeek
// 目录写 llm-deepseek.models，预置/自定义提供方写 llm-pi-ai.providers，模型
// 发现走 llm.discoverModels。全部提供方只在此弹窗出现，不再平铺在页面上。

export interface ModelProfile { id: string; name?: string; contextWindow?: number }
export interface PiProviderProfile {
  apiKeyEnv?: string;
  displayName?: string;
  api?: string;
  baseURL?: string;
  models?: ModelProfile[];
}
export interface ProviderInfo { provider: string; displayName: string; settingsNs: string; active: boolean }

export interface DeepseekNs { revision: unknown; apiKeyEnv: string; models: ModelProfile[] }
export interface PiNs { revision: unknown; providers: Record<string, PiProviderProfile> }

export interface EditTarget {
  provider: string;
  kind: "deepseek" | "pi";
  /** 编辑的目录条目原 id（deepseek / 已落盘 pi 目录行才有；引擎声明目录行无）。 */
  origId?: string;
}

const MANUAL = "__manual__";
const NEW_MODEL = "__new__";
const NEW_PROVIDER = "__new__";

export function keyRefOf(provider: string, deepseekApiKeyEnv: string): string {
  if (provider === "deepseek-official") return deepseekApiKeyEnv || "DEEPSEEK_API_KEY";
  return provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_") + "_API_KEY";
}

/** DeepSeek 模型目录整体落盘（settings.update + revision 围栏）。 */
export async function updateDeepseekModels(models: ModelProfile[]) {
  const d = await api.settingsDescribe();
  const ns = (d.namespaces ?? []).find((n) => n.ns === "llm-deepseek");
  if (!ns) throw new Error(t("本引擎未提供模型目录。"));
  await api.settingsUpdate({ ns: "llm-deepseek", patch: { ...(ns.value ?? {}), models }, expectedRevision: ns.revision });
}

/** llm-pi-ai.providers 对象图整体落盘（settings.update + revision 围栏）。 */
export async function updatePiProviders(providers: Record<string, PiProviderProfile>) {
  const d = await api.settingsDescribe();
  const ns = (d.namespaces ?? []).find((n) => n.ns === "llm-pi-ai");
  if (!ns) throw new Error(t("本引擎未提供自定义提供方。"));
  await api.settingsUpdate({ ns: "llm-pi-ai", patch: { ...(ns.value ?? {}), providers }, expectedRevision: ns.revision });
}

export function ModelDialog({ providers, deepseek, pi, edit, credentials, onDone, onCancel }: {
  providers: ProviderInfo[];
  deepseek: DeepseekNs;
  pi: PiNs;
  edit: EditTarget | null;
  /** 各提供方 keyRef → 密钥已配置（弹窗占位文案用）。 */
  credentials: Record<string, boolean>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const info = edit ? providers.find((p) => p.provider === edit.provider) : undefined;
  const [providerId, setProviderId] = useState(edit?.provider ?? "");
  const isNewProvider = !edit && providerId === NEW_PROVIDER;
  const profile = providerId && providerId !== NEW_PROVIDER ? pi.providers[providerId] : undefined;
  const knownModels: ModelProfile[] =
    providerId === "deepseek-official" ? deepseek.models : (profile?.models ?? []);

  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [modelChoice, setModelChoice] = useState<string>(edit?.origId ?? "");
  const [modelId, setModelId] = useState(edit?.origId ?? "");
  const [modelName, setModelName] = useState("");
  const [modelContext, setModelContext] = useState("");
  const [newId, setNewId] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [apiProto, setApiProto] = useState("");
  const [discovered, setDiscovered] = useState<ModelProfile[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const isDeepseek = providerId === "deepseek-official";
  const needsManual = isNewProvider || knownModels.length === 0 || modelChoice === MANUAL;
  // 编辑目录条目（deepseek 行 / 已落盘的 pi 目录行）时直接展开条目字段
  const editingEntry = !!edit && (edit.kind === "deepseek" || !!edit.origId);
  const showEntryFields = editingEntry || (!edit && isDeepseek && modelChoice === NEW_MODEL);
  const withContext = isDeepseek;
  const keyRef = keyRefOf(providerId || edit?.provider || "", deepseek.apiKeyEnv);
  const keyIsConfigured = !!credentials[keyRef] || !!edit;

  const discover = async () => {
    setDiscovering(true);
    setError(null);
    try {
      const r = await api.discoverModels({
        settingsNs: "llm-pi-ai",
        ...(isNewProvider ? { baseURL, api: apiProto } : { provider: providerId }),
      });
      setDiscovered((r.models ?? []).map((m) => ({ id: m.id, name: m.name, contextWindow: m.contextWindow })));
    } catch (err) {
      setError(t("发现模型失败：{m}").replace("{m}", (err as Error).message));
    }
    setDiscovering(false);
  };

  const save = async () => {
    setError(null);
    const pid = providerId;
    if (!pid) { setError(t("请选择提供方。")); return; }
    if (isNewProvider) {
      const id = newId.trim();
      if (!id || pi.providers[id]) { setError(t("提供方 ID 必填且不可与现有重复。")); return; }
      if (!discovered && !modelId.trim()) { setError(t("模型 ID 必填。")); return; }
    } else if ((editingEntry || (needsManual && !discovered)) && !modelId.trim()) {
      setError(t("模型 ID 必填。"));
      return;
    }
    setSaving(true);
    try {
      // ① 密钥：留空 = 保持不变
      if (key.trim()) {
        await api.credentialsSet({ ref: keyRef, value: key.trim() });
      }
      // ② 目录（按提供方落点分流）
      if (isDeepseek && (editingEntry || (!edit && modelChoice === NEW_MODEL))) {
        const entry: ModelProfile = {
          id: modelId.trim(),
          ...(modelName.trim() ? { name: modelName.trim() } : {}),
          ...(modelContext.trim() ? { contextWindow: Number(modelContext) } : {}),
        };
        const models = edit?.origId
          ? deepseek.models.map((m) => (m.id === edit.origId ? entry : m))
          : [...deepseek.models.filter((m) => m.id !== entry.id), entry];
        await updateDeepseekModels(models);
      } else if (isNewProvider) {
        const models = discovered ?? [{ id: modelId.trim() }];
        await updatePiProviders({
          ...pi.providers,
          [newId.trim()]: {
            displayName: newDisplayName.trim() || newId.trim(),
            ...(baseURL.trim() ? { baseURL: baseURL.trim() } : {}),
            ...(apiProto.trim() ? { api: apiProto.trim() } : {}),
            models,
          },
        });
      } else if (!isDeepseek && (edit?.origId || discovered || (!edit && needsManual && modelId.trim()))) {
        const prev = profile ?? {};
        let models = prev.models ?? [];
        if (edit?.origId) {
          const entry: ModelProfile = { id: modelId.trim(), ...(modelName.trim() ? { name: modelName.trim() } : {}) };
          models = models.map((m) => (m.id === edit.origId ? entry : m));
        } else if (discovered) {
          models = discovered;
        } else {
          models = [...models.filter((m) => m.id !== modelId.trim()), { id: modelId.trim() }];
        }
        await updatePiProviders({ ...pi.providers, [pid]: { ...prev, models } });
      }
      onDone();
    } catch (err) {
      setError(t("保存失败：{m}").replace("{m}", (err as Error).message));
    }
    setSaving(false);
  };

  const providerOptions = [
    ...providers.map((p) => ({ v: p.provider, label: p.displayName })),
    { v: NEW_PROVIDER, label: t("＋ 新建自定义提供方…") },
  ];
  const modelOptions = [
    ...((isNewProvider ? discovered : knownModels) ?? []).map((m) => ({ v: m.id, label: m.name || m.id })),
    ...(isDeepseek && !edit ? [{ v: NEW_MODEL, label: t("＋ 新建模型…") }] : []),
    ...(!isDeepseek && !edit ? [{ v: MANUAL, label: t("手动输入模型 ID…") }] : []),
  ];

  return createPortal(
    // 关闭只认"按下 overlay 自身"（target===currentTarget）：Dropdown 的菜单
    // portal 在 DOM 上挂 body，但其点击沿 React 树冒泡会路过这里——若用
    // onClick+stopPropagation 拦截，选提供方的第一下就会把整个弹窗关掉。
    <div
      className={cssRows.modalOverlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="dialog"
      aria-label={edit ? t("编辑模型") : t("添加模型")}
    >
      <div className={cssRows.modal} onClick={(e) => e.stopPropagation()}>
        <div className={cssRows.modalHead}>
          <span className={cssRows.modalTitle}>{edit ? t("编辑模型") : t("添加模型")}</span>
          <span className={cssRows.modalBadge}>{t("写入引擎配置，保存即生效")}</span>
          <button className={cssRows.iconBtn} style={{ marginLeft: "auto" }} onClick={onCancel} aria-label={t("关闭")}>
            <X size={15} />
          </button>
        </div>
        <div className={cssRows.modalBody}>
          <div>
            <span className={cssRows.fieldLabel}>{t("提供商")}</span>
            {edit ? (
              <div className={cssRows.modelProviderLocked}>
                <ProviderIcon provider={providerId} size={15} />
                <span>{info?.displayName ?? providerId}</span>
                <span className={cssRows.mono}>{providerId}</span>
              </div>
            ) : (
              <Dropdown
                options={providerOptions}
                value={providerId}
                onChange={(v) => { setProviderId(v); setModelChoice(""); setModelId(""); setDiscovered(null); setError(null); }}
              />
            )}
          </div>
          {isNewProvider && (
            <>
              <div className={cssRows.fieldGrid2}>
                <div>
                  <span className={cssRows.fieldLabel}>{t("提供方 ID")}</span>
                  <input className={cssRows.textField} placeholder="openrouter" value={newId} onChange={(e) => setNewId(e.target.value)} />
                </div>
                <div>
                  <span className={cssRows.fieldLabel}>{t("显示名称")}</span>
                  <input className={cssRows.textField} value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} />
                </div>
              </div>
              <div>
                <span className={cssRows.fieldLabel}>baseURL</span>
                <input className={cssRows.textField} placeholder="https://…" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} />
              </div>
              <div>
                <span className={cssRows.fieldLabel}>{t("协议（openai-completions / openai-responses）")}</span>
                <input className={cssRows.textField} value={apiProto} onChange={(e) => setApiProto(e.target.value)} />
              </div>
            </>
          )}
          <div>
            <span className={cssRows.fieldLabel}>API Key</span>
            <div className={cssRows.fieldRow}>
              <input
                className={cssRows.textField}
                style={{ flex: 1 }}
                type={showKey ? "text" : "password"}
                placeholder={keyIsConfigured ? t("已配置 —— 留空保持不变") : t("输入你的 API Key")}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <button className={cssRows.iconBtn} onClick={() => setShowKey(!showKey)} aria-label={t("显示密钥")}>
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          {showEntryFields ? (
            <EntryFields
              modelId={modelId} setModelId={setModelId}
              modelName={modelName} setModelName={setModelName}
              modelContext={modelContext} setModelContext={setModelContext}
              withContext={withContext}
            />
          ) : !edit && needsManual ? (
            <div>
              <span className={cssRows.fieldLabel}>{t("模型名称")}</span>
              <div className={cssRows.fieldRow}>
                <input className={cssRows.textField} style={{ flex: 1 }} placeholder={t("模型名为空则自动添加已有模型")} value={modelId} onChange={(e) => setModelId(e.target.value)} />
                {(isNewProvider || profile) && (
                  <button className={cssRows.secondaryButton} disabled={discovering} onClick={() => void discover()}>
                    {discovering ? t("载入中…") : t("发现模型")}
                  </button>
                )}
              </div>
            </div>
          ) : !edit ? (
            <div>
              <span className={cssRows.fieldLabel}>{t("模型名称")}</span>
              <Dropdown
                options={modelOptions}
                value={modelChoice}
                onChange={(v) => {
                  setModelChoice(v);
                  setModelId(v === MANUAL || v === NEW_MODEL ? "" : v);
                }}
              />
            </div>
          ) : null}
          {error && <div className={cssRows.modelError}>{error}</div>}
        </div>
        <div className={cssRows.modalFoot}>
          <button className={cssRows.secondaryButton} onClick={onCancel}>{t("取消")}</button>
          <button className={cssRows.primaryButton} disabled={saving} onClick={() => void save()}>
            {saving ? t("载入中…") : t("保存")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function EntryFields({ modelId, setModelId, modelName, setModelName, modelContext, setModelContext, withContext }: {
  modelId: string; setModelId: (v: string) => void;
  modelName: string; setModelName: (v: string) => void;
  modelContext: string; setModelContext: (v: string) => void;
  withContext: boolean;
}) {
  // grid 定版（fr 轨道 + input 整宽）：flex 嵌套百分比宽 input 在 WKWebView
  // 里会塌缩成细条（用户报告的"编辑栏重叠"），grid 不受此怪癖影响。
  return (
    <div className={`${cssRows.fieldGrid}${withContext ? ` ${cssRows.fieldGridCtx}` : ""}`}>
      <div>
        <span className={cssRows.fieldLabel}>{t("模型 ID")}</span>
        <input className={cssRows.textField} value={modelId} onChange={(e) => setModelId(e.target.value)} />
      </div>
      <div>
        <span className={cssRows.fieldLabel}>{t("显示名称")}</span>
        <input className={cssRows.textField} value={modelName} onChange={(e) => setModelName(e.target.value)} />
      </div>
      {withContext && (
        <div>
          <span className={cssRows.fieldLabel}>{t("上下文窗口")}</span>
          <input className={cssRows.textField} value={modelContext} onChange={(e) => setModelContext(e.target.value)} />
        </div>
      )}
    </div>
  );
}
