import { useState } from "react";
import { Eye, EyeOff, X } from "lucide-react";
import { SettingsConflictError, writeNamespaceOnce } from "./useSettingNamespace";
import { api } from "../api";
import { t, tt } from "../i18n";
import { ProviderIcon } from "../components/ProviderIcon";
import { Dropdown } from "../components/controls";
import { HIDDEN_PROVIDERS, PROVIDER_SESSION_HEADERS, providerLabel } from "./vendors";
import { uuid } from "../uuid";
import cssRows from "./SettingsRows.module.css";
import { Modal } from "../components/Modal";

// 添加/编辑模型弹窗（版式照参考图）：提供商 → 接口地址 → API Key → 模型名称 →
// 高级配置（模型类型）。字段落点按适配器分流——密钥走 credentials.set，DeepSeek
// 官方目录写 llm-deepseek.models，预置/手写提供方写 llm-pi-ai.providers，模型
// 发现走 llm.discoverModels。可声明的协议从 llm-pi-ai 的 schema 读（piProtocols.ts），
// 前端不另存一份协议表。pi 提供方存密钥时必须同时声明 ref（apiKeyDeclaration）：
// 引擎只按 profile 的 apiKeyEnv 去凭据服务取密钥。
//
// 条目字段以各适配器自己的 Config 为准（0.1.2-rc.1 settings/describe 实测）：
//   · pi      ：id / name / contextWindow / maxTokens / input / reasoningEfforts / compat
//   · deepseek：id / name / description / contextWindow / maxTokens / inputModalities / …
// 两家的输入模态词表都只有 text 与 image（视频、音频写进去会被 schema 拒绝），
// 所以「模型类型」只提供视觉（图片输入）一项。

/** BaseURL 规范化与校验（§2）：去空白、补 https:// 缺省协议、去尾斜杠；
 *  返回 null 表示无法成为合法 http(s) 地址。 */
export function normalizeBaseURL(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    return u.origin + (u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, ""));
  } catch {
    return null;
  }
}

/** 手写路由 id：引擎里那条路由的 settings 键，同时经 keyRefOf 派生密钥名
 *  （<ID>_API_KEY）。引擎只硬性要求派生出的名字匹配 `/^[A-Za-z_][A-Za-z0-9_]*$/`
 *  ——实测 `9x-gateway` 被拒：`credential ref "9X_GATEWAY_API_KEY" must match …`，
 *  而 `Acme-Gateway`、`acme_gateway`、`acme.gateway` 都能落盘并服务。所以这里
 *  只要求「字母开头 + 字母/数字/连字符」，大小写不限；分隔符多音（`a.b` 与 `a-b`
 *  会折成同一个密钥名）不放开，免得两条路由共用一把密钥。 */
const ROUTE_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/;
export function isRouteId(value: string): boolean {
  return ROUTE_PATTERN.test(value);
}

/** 路由 id 的默认值：取接口地址的主机名，非字母数字折成 "-"，去首尾与连续连字符。
 *  推不出（地址无效，或主机名以数字开头——那样派生的密钥名引擎不收）时返回空串，
 *  由调用方要求用户手填。 */
export function deriveRouteFromBaseURL(raw: string): string {
  const normalized = normalizeBaseURL(raw);
  if (normalized === null) return "";
  const host = new URL(normalized).hostname.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return /^[a-z][a-z0-9-]*$/.test(host) ? host : "";
}

/** llm.discoverModels 的候选（引擎只回这四个字段）。 */
export interface DiscoveredModel { id: string; name?: string; contextWindow?: number; maxTokens?: number }

/** llm-pi-ai 的模型条目：模态字段拼写是 input。 */
export interface PiModelEntry extends DiscoveredModel {
  input?: string[];
}

/** llm-deepseek 的目录条目：模态字段拼写是 inputModalities。 */
export interface DeepseekModelEntry extends DiscoveredModel {
  description?: string;
  inputModalities?: string[];
}

export interface PiProviderProfile {
  apiKeyEnv?: string;
  displayName?: string;
  api?: string;
  baseURL?: string;
  /** 路由级请求头（引擎 `llm-pi-ai` profile 的字段）；会话头见 {@link sessionHeaders}。 */
  headers?: Record<string, string>;
  models?: PiModelEntry[];
  /** 按 id 改目录里那一个模型、其余照旧服务（引擎 llm-pi-ai 的 modelOverrides）。 */
  modelOverrides?: Record<string, Omit<PiModelEntry, "id">>;
}
export interface ProviderInfo { provider: string; displayName: string; settingsNs: string; settingsPath?: string[]; active: boolean; /** 用户在 llm-pi-ai 落盘过 profile 的自定义提供方＝可组级删除。 */ declared?: boolean }

export interface DeepseekNs { apiKeyEnv: string; models: DeepseekModelEntry[] }
export interface PiNs { providers: Record<string, PiProviderProfile> }

export interface EditTarget {
  provider: string;
  kind: "deepseek" | "pi";
  /** 正在编辑的模型 id（回填输入框）。 */
  origId: string;
  /** 该 id 是否已落盘成用户条目：引擎目录行＝false，保存时按"改目录条目"处理。 */
  listed: boolean;
}

/** 提供方下拉里的「自定义」项：选它＝手写一条路由（接口地址 + 协议 + 模型）。 */
export const CUSTOM_PROVIDER = "__custom__";

export function keyRefOf(provider: string, deepseekApiKeyEnv: string): string {
  if (provider === "deepseek-official") return deepseekApiKeyEnv || "DEEPSEEK_API_KEY";
  return provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_") + "_API_KEY";
}

/** DeepSeek 模型目录整体落盘（settings.update + revision 围栏）。 */
export async function updateDeepseekModels(models: DeepseekModelEntry[]) {
  await writeNamespaceOnce("llm-deepseek", t("本引擎未提供模型目录。"), async (ns) => {
    await api.settingsUpdate({ ns: "llm-deepseek", patch: { ...(ns.value ?? {}), models }, expectedRevision: ns.revision });
  });
}

/** llm-pi-ai.providers 对象图整体落盘（settings.update + revision 围栏）。 */
export async function updatePiProviders(providers: Record<string, PiProviderProfile>) {
  await writeNamespaceOnce("llm-pi-ai", t("本引擎未提供自定义提供方。"), async (ns) => {
    await api.settingsUpdate({ ns: "llm-pi-ai", patch: { ...(ns.value ?? {}), providers }, expectedRevision: ns.revision });
  });
}

/** 删除整个自定义提供方（settings.mutate unset + revision 围栏）：
 *  settings.update 是合并语义，patch 里缺键删不掉对象条目，只有路径级
 *  unset 能真正移除 provider key。密钥由调用方按需 credentials.unset。 */
export async function removePiProvider(providerId: string) {
  await writeNamespaceOnce("llm-pi-ai", t("本引擎未提供自定义提供方。"), async (ns) => {
    await api.settingsMutate({ ns: "llm-pi-ai", ops: [{ op: "unset", path: ["providers", providerId] }], expectedRevision: ns.revision });
  });
}

/** 模型类型声明落在哪个字段：pi 是 input，deepseek 是 inputModalities。 */
export function visualKeyOf(providerId: string): "input" | "inputModalities" {
  return providerId === "deepseek-official" ? "inputModalities" : "input";
}

/** 条目上已声明的输入模态（读原条目，回填勾选态）。 */
export function declaredInput(entry: unknown, key: "input" | "inputModalities"): string[] {
  const list = (entry as Record<string, unknown> | null | undefined)?.[key];
  return Array.isArray(list) ? list.filter((m): m is string => typeof m === "string") : [];
}

/** 回写一条目录条目：原条目整条带过——界面不编辑的字段（description、
 *  imagePixelBudget、maxTokens、reasoningEfforts、compat…）不能因为一次编辑
 *  被整条替换抹掉；只落 id 与模型类型声明。取消勾选＝不声明（引擎按目录条目
 *  或路由默认收口），不是声明成纯文本——后者会把目录里带视觉的条目降级。 */
export function rewriteEntry<T extends { id: string }>(
  orig: T | undefined,
  id: string,
  key: "input" | "inputModalities",
  visual: boolean,
): T {
  const next = { ...(orig ?? {}), id } as Record<string, unknown>;
  if (visual) next[key] = ["text", "image"];
  else delete next[key];
  return next as T;
}

/** 回写一条 modelOverrides 项：形状与条目相同但没有 id（id 是字典的键）。
 *  返回 null＝这条声明清空后无话可说，调用方把该键删掉而不是留一个空对象。 */
export function rewriteOverride(
  orig: Omit<PiModelEntry, "id"> | undefined,
  key: "input" | "inputModalities",
  visual: boolean,
): Omit<PiModelEntry, "id"> | null {
  const next = { ...(orig ?? {}) } as Record<string, unknown>;
  if (visual) next[key] = ["text", "image"];
  else delete next[key];
  return Object.keys(next).length === 0 ? null : (next as Omit<PiModelEntry, "id">);
}

/** 一次保存里的密钥声明：**这次填了密钥，就必须在 profile 上声明它落库用的那个
 *  ref**（`apiKeyEnv`）。引擎只按 profile 的这个字段去凭据服务取密钥，路由没声明
 *  就等于没有密钥——密钥存在、界面显示"已配置"，请求仍以
 *  `Provider is not configured: <路由 id>` 失败（pi-ai 兜底只找它自己那套环境名，
 *  与 `keyRefOf` 派生的名字对不上）。预置提供方与手写路由同此一规：两者的密钥都
 *  落在 credentials。留空＝不表态：profile 里原有的声明（有的话）由调用方带过。
 *  @param typedKey - 用户在这次保存里填的密钥。
 *  @param ref - 密钥落库用的 ref（{@link keyRefOf} 派生）。
 *  @returns 要并进 profile 的字段；留空时为空对象。 */
export function apiKeyDeclaration(typedKey: string, ref: string): Pick<PiProviderProfile, "apiKeyEnv"> {
  return typedKey.trim() ? { apiKeyEnv: ref } : {};
}

/** 该提供方的路由要带的会话头（表在 {@link PROVIDER_SESSION_HEADERS}）：值沿用
 *  profile 里已有的——它是端点的路由身份，每次保存换一个等于每次换身份；没有才
 *  现在生成。表外的提供方不加头（不认识的端点没有可猜的规矩）。
 *  @param provider - 提供方 id（也是 profile 的键）。
 *  @param existing - profile 里已有的头，原样保留。
 *  @returns 要并进 profile 的头；该提供方不需要时为 undefined。 */
export function sessionHeaders(
  provider: string,
  existing: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
  const name = PROVIDER_SESSION_HEADERS[provider];
  if (name === undefined) return undefined;
  return { ...existing, [name]: existing?.[name] ?? uuid() };
}

export function ModelDialog({ providers, deepseek, pi, piProtocols, edit, initialProvider, credentials, onDone, onCancel }: {
  providers: ProviderInfo[];
  deepseek: DeepseekNs;
  pi: PiNs;
  /** 手写路由可声明的协议（引擎 llm-pi-ai schema 的枚举；空＝本引擎没有自定义入口）。 */
  piProtocols: string[];
  edit: EditTarget | null;
  /** 添加模式下预选的提供方（「快速添加」点厂商带 provider id，点自定义带 CUSTOM_PROVIDER）。 */
  initialProvider?: string;
  /** 各提供方 keyRef → 密钥已配置（弹窗占位文案用）。 */
  credentials: Record<string, boolean>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const info = edit ? providers.find((p) => p.provider === edit.provider) : undefined;
  // 添加模式默认 DeepSeek 官方（引擎目录必有；编辑模式仍按编辑对象回填）。
  const [providerId, setProviderId] = useState(edit?.provider ?? initialProvider ?? "deepseek-official");
  const isCustom = !edit && providerId === CUSTOM_PROVIDER;
  const isDeepseek = providerId === "deepseek-official";
  const profile = providerId && !isCustom ? pi.providers[providerId] : undefined;
  const knownEntries: Array<PiModelEntry | DeepseekModelEntry> =
    isDeepseek ? deepseek.models : (profile?.models ?? []);
  // 编辑已落盘条目必须回填原字段（AUD-067）：条目整条替换，界面不展示的字段
  // （显示名、容量…）靠 rewriteEntry 从原条目带过来。引擎目录行没有用户条目，
  // 读不到声明，勾选态按"未声明"起手。
  const origEntry = edit?.listed ? knownEntries.find((m) => m.id === edit.origId) : undefined;
  const visualKey = visualKeyOf(providerId);

  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [modelId, setModelId] = useState(edit?.origId ?? "");
  const [visual, setVisual] = useState(declaredInput(origEntry, visualKey).includes("image"));
  const [route, setRoute] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [apiProto, setApiProto] = useState(piProtocols[0] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** 手写路由的名字：用户填了就用填的，留空按接口地址取（输入框把推导值当占位显示）。 */
  const derivedRoute = deriveRouteFromBaseURL(baseURL);
  const finalRoute = route.trim() || derivedRoute;
  const keyRef = keyRefOf(isCustom ? finalRoute : (providerId || edit?.provider || ""), deepseek.apiKeyEnv);
  // 已配置与否只认 credentials 实况（AUD-101）：编辑态加 `|| !!edit` 会让
  // 未配 key 的提供方也显示"已配置——留空保持不变"，误导用户以为有旧值。
  const keyIsConfigured = !!credentials[keyRef];
  /** 模型名称留空＝保存时问提供方要一份清单（手写路由靠它一次配齐）；编辑态名称必填。 */
  const discoversAll = !isDeepseek && edit === null;

  /** 向提供方要一份模型清单：手写路由上送表单里的接口地址与协议，
   *  预置提供方只报 id；带 apiKey 时用刚填的 Key（还没落盘）。 */
  const discover = async (apiKey: string): Promise<DiscoveredModel[]> => {
    const r = await api.discoverModels({
      settingsNs: "llm-pi-ai",
      ...(isCustom
        ? { baseURL: normalizeBaseURL(baseURL) ?? baseURL.trim(), api: apiProto }
        : { provider: providerId }),
      ...(apiKey ? { apiKey } : {}),
    });
    return (r ?? []).map((m) => ({ id: m.id, name: m.name, contextWindow: m.contextWindow, maxTokens: m.maxTokens }));
  };

  const save = async () => {
    setError(null);
    const typedId = modelId.trim();
    // §2：baseURL 只在填写时校验/规范化（引擎侧同样校验，这里给内联前置反馈）；
    // 手写路由则必填——引擎靠它定端点，空着只会在发现那步报一条看不懂的错。
    const typedBase = baseURL.trim();
    const normalizedBaseURL = typedBase ? normalizeBaseURL(typedBase) : "";
    if (isCustom && !typedBase) { setError(t("接口地址必填。")); return; }
    if (normalizedBaseURL === null) {
      setError(tt("接口地址无效：需要 http(s) 地址，如 https://api.example.com/v1", "Invalid endpoint: expected an http(s) URL like https://api.example.com/v1"));
      return;
    }
    if (isCustom) {
      if (!isRouteId(finalRoute)) { setError(t("提供方 ID 只能用字母、数字和连字符，并以字母开头。")); return; }
      if (providers.some((p) => p.provider === finalRoute) || pi.providers[finalRoute] !== undefined) { setError(t("这个 ID 已被使用，请在高级配置里换一个。")); return; }
    }
    // 模型类型描述的是一个具体模型；留空＝整体并入发现结果，标注无处可落。
    if (visual && !typedId) { setError(t("要标注模型类型，先填模型名称。")); return; }
    // 目录条目没有 id 无法落盘（DeepSeek 官方没有发现路由，编辑态同样必须有个 id）。
    if (!typedId && (isDeepseek || edit !== null)) { setError(t("模型名称必填。")); return; }
    setSaving(true);
    try {
      // ① 密钥：留空 = 保持不变
      if (key.trim()) {
        await api.credentialsSet({ ref: keyRef, value: key.trim() });
      }
      // ② pi 提供方且手填了一个模型名时直接用；留空才去发现（发现失败必须
      //    报错退出——静默回落成"只加一个空 id"会写坏目录）。
      let discovered: DiscoveredModel[] | null = null;
      if (discoversAll && !typedId) {
        try {
          discovered = await discover(key.trim());
        } catch (err) {
          setError(tt("自动发现模型失败：{m}", "Auto-discovery failed: {m}", { m: (err as Error).message }));
          setSaving(false);
          return;
        }
        if (!discovered.length) {
          setError(t("该提供方未发现任何模型，请手动填写模型名称。"));
          setSaving(false);
          return;
        }
      }
      // ③ 落点分流（同 id 的旧条目在新增路径上先滤掉，避免出现重复目录行）。
      if (isDeepseek) {
        const entry = rewriteEntry<DeepseekModelEntry>(origEntry as DeepseekModelEntry | undefined, typedId, visualKey, visual);
        const models = edit
          ? deepseek.models.map((m) => (m.id === edit.origId ? entry : m))
          : [...deepseek.models.filter((m) => m.id !== typedId), entry];
        await updateDeepseekModels(models);
      } else if (isCustom) {
        const models = discovered ?? [rewriteEntry<PiModelEntry>(undefined, typedId, "input", visual)];
        await updatePiProviders({
          ...pi.providers,
          [finalRoute]: {
            ...apiKeyDeclaration(key, keyRef),
            api: apiProto,
            baseURL: normalizedBaseURL,
            models,
          },
        });
      } else {
        const prev = profile ?? {};
        // 预置提供方的密钥同样要声明在 profile 上（apiKeyDeclaration）：只在
        // credentials 里存着而 profile 不声明 ref，路由就是"没配密钥"；少数端点
        // 还要求会话头（sessionHeaders），一并在这里落。
        const headers = sessionHeaders(providerId, prev.headers);
        const merged = {
          ...prev,
          ...apiKeyDeclaration(key, keyRef),
          ...(headers === undefined ? {} : { headers }),
        };
        if (edit && !edit.listed && typedId === edit.origId) {
          // 引擎目录行：写 modelOverrides[id]，目录里其余模型照旧服务——models
          // 列表是"这份清单就是全部"，照它写会把该提供方的其它模型挤掉。
          const overrides = { ...(prev.modelOverrides ?? {}) };
          const next = rewriteOverride(overrides[typedId], "input", visual);
          if (next === null) delete overrides[typedId];
          else overrides[typedId] = next;
          await updatePiProviders({ ...pi.providers, [providerId]: { ...merged, modelOverrides: overrides } });
        } else {
          const models = discovered ?? (edit
            ? (prev.models ?? []).map((m) => (m.id === edit.origId
              ? rewriteEntry<PiModelEntry>(origEntry as PiModelEntry | undefined, typedId, "input", visual)
              : m))
            : [...(prev.models ?? []).filter((m) => m.id !== typedId), rewriteEntry<PiModelEntry>(undefined, typedId, "input", visual)]);
          await updatePiProviders({ ...pi.providers, [providerId]: { ...merged, models } });
        }
      }
      onDone();
    } catch (err) {
      setError(tt("保存失败：{m}", "Save failed: {m}", {
        m: err instanceof SettingsConflictError ? t("设置已在其他位置被修改。") : (err as Error).message,
      }));
    }
    setSaving(false);
  };

  const providerOptions = [
    ...providers
      .filter((p) => !HIDDEN_PROVIDERS.includes(p.provider) || pi.providers[p.provider] !== undefined)
      .map((p) => ({
        v: p.provider,
        label: providerLabel(p.provider, p.displayName),
        iconNode: <ProviderIcon provider={p.provider} size={14} />,
      })),
    { v: CUSTOM_PROVIDER, label: t("自定义 / Custom") },
  ];
  const protocolOptions = piProtocols.map((p) => ({ v: p, label: p }));

  return (
    <Modal
      open
      onClose={onCancel}
      cardClassName={cssRows.modal}
      ariaLabel={edit ? t("编辑模型") : t("添加模型")}
    >
      <div className={cssRows.modalHead}>
        <span className={cssRows.modalTitle}>{edit ? t("编辑模型") : t("添加模型")}</span>
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
              <span>{providerLabel(providerId, info?.displayName ?? providerId)}</span>
              <span className={cssRows.mono}>{providerId}</span>
            </div>
          ) : (
            <Dropdown
              block
              options={providerOptions}
              value={providerId}
              onChange={(v) => { setProviderId(v); setModelId(""); setVisual(false); setError(null); }}
            />
          )}
        </div>
        {isCustom && (
          <div>
            <span className={cssRows.fieldLabel}>{t("接口地址")}</span>
            <input
              className={cssRows.textField}
              style={{ display: "block", width: "100%" }}
              placeholder="https://api.example.com/v1"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              onBlur={() => { if (baseURL.trim()) { const n = normalizeBaseURL(baseURL); if (n) setBaseURL(n); } }}
            />
          </div>
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
        <div>
          <span className={cssRows.fieldLabel}>{t("模型名称")}</span>
          <input
            className={cssRows.textField}
            style={{ display: "block", width: "100%" }}
            placeholder={isDeepseek ? "例如 deepseek-v4-flash" : "例如 gpt-4o 或 deepseek-chat"}
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
          />
          {discoversAll && <div className={cssRows.fieldHint}>{t("留空则添加该提供方的全部模型")}</div>}
        </div>
        <div>
          <div className={cssRows.advTitle}>{t("高级配置")}</div>
          {isCustom && (
            <>
              <div className={cssRows.advField}>
                <span className={cssRows.fieldLabel}>{t("提供方 ID")}</span>
                {/* 引擎里那条路由的键（也是密钥名）；留空＝按接口地址取名，
                    placeholder 把推导出来的名字直接摆出来，不再写一行说明。 */}
                <input
                  className={cssRows.textField}
                  style={{ display: "block", width: "100%" }}
                  placeholder={derivedRoute || "acme-gateway"}
                  value={route}
                  onChange={(e) => setRoute(e.target.value)}
                />
              </div>
              <div className={cssRows.advField}>
                <span className={cssRows.fieldLabel}>{t("协议")}</span>
                {/* 默认取引擎报的第一个协议（provider.ts 的表首＝手写网关最常说的
                    openai-completions），照官方卡片的默认口径。 */}
                <Dropdown block options={protocolOptions} value={apiProto} onChange={setApiProto} />
              </div>
            </>
          )}
          <label className={cssRows.checkRow}>
            <input type="checkbox" checked={visual} onChange={(e) => setVisual(e.target.checked)} />
            <span>{t("视觉（图片输入）")}</span>
          </label>
        </div>
        {error && <div className={cssRows.modelError}>{error}</div>}
      </div>
      <div className={cssRows.modalFoot}>
        <button className={cssRows.secondaryButton} onClick={onCancel}>{t("取消")}</button>
        <button className={cssRows.primaryButton} disabled={saving} onClick={() => void save()}>
          {saving ? t("载入中…") : t("保存")}
        </button>
      </div>
    </Modal>
  );
}
