// 新手引导「迁移」步的后半截：把其他 Agent 的**模型配置**映射成本应用的目标形状
// （内置提供方的凭据 ref / 自定义提供方路由），一处实现、纯函数可测。
//
// 输入是壳读回来的配置原文（`apps/macos/.../AgentConfigScan.swift` 只搬运不解析），
// 输出是"导入计划"——界面按计划展示可读字段与不可导入的原因，用户点导入才落库。
//
// 两条纪律：① **一律不猜**——提供方身份只认两张显式表（端点主机名 / 来源 provider id）
// 与一张协议表，表外一律标"不支持导入"并给出原因；② **内置提供方只导密钥**：写
// `models` 非空会让引擎整体替换该路由目录（PITFALLS §7.4），而内置提供方的目录是
// 引擎给的；只有引擎目录里没有的自定义端点才写 models——那是它唯一的模型来源。
// 落库后必须 re-describe 校验：坏 profile 会让引擎**静默丢掉整个 llm-pi-ai 段**
//（PITFALLS §7.4），校验不过即回滚并如实报错。
import { api } from "../api";
import { tt } from "../i18n";
import { keyRefOf, type PiProviderProfile, type ProviderInfo } from "../settings/ModelDialog";
import { writeNamespaceOnce } from "../settings/useSettingNamespace";

/** 引擎可声明的 wire 协议三值（权威在 `llm-pi-ai/provider.ts` 的 PROTOCOLS；此处是
 *  类型镜像，运行期是否可用以引擎 schema 的 `protocols` 为准，见 PlanInput）。 */
type Protocol = "openai-completions" | "openai-responses" | "anthropic-messages";

/** 提供方身份表之一：端点主机名 → 本应用内置提供方 id。判据是**同一个服务端点**
 *  （不是名字相似）；新增一行要有站得住的理由与一条测试。 */
const BUILTIN_BY_HOST: Record<string, string> = {
  "api.deepseek.com": "deepseek-official",
};

/** 提供方身份表之二：来源自己的 provider id → 本应用内置提供方 id。只在来源配置
 *  里没有端点（如 opencode 的 auth.json 只存密钥）但 id 就是那家服务时用。 */
const BUILTIN_BY_SOURCE_ID: Record<string, Record<string, string>> = {
  opencode: { deepseek: "deepseek-official" },
};

/** 来源的协议写法 → 引擎协议：zcode 只有 anthropic / openai-compatible 两值；
 *  pi 的 `api` 字段直接就是枚举值，走同一张表。 */
const PROTOCOL_BY_KIND: Record<string, Protocol> = {
  anthropic: "anthropic-messages",
  "openai-compatible": "openai-completions",
};

export interface ModelImportItem {
  source: string;
  /** 展示用（来源里的名字）。 */
  label: string;
  /** 凭证 ref：内置提供方用它命名空间的 apiKeyEnv，自定义路由按引擎规则派生。 */
  ref: string;
  /** 目标是内置提供方时的引擎 provider id。 */
  providerId?: string;
  /** 自定义路由才有：路由 id（已过命名规则校验）、端点、协议、模型清单。 */
  routeId?: string;
  baseURL?: string;
  api?: Protocol;
  models?: NonNullable<PiProviderProfile["models"]>;
  /** 密钥原文：只在用户点「导入」后经 credentials/set 落库，界面不展示、绝不落日志。 */
  key: string;
}

/** 不可导入的说明（按来源展示，别让用户把"不支持"读成"没检测到"）。 */
export interface ModelImportNote {
  source: string;
  label: string;
  reason: string;
}

export interface ModelImportPlan {
  items: ModelImportItem[];
  notes: ModelImportNote[];
}

export interface PlanInput {
  /** 来源 id → 配置原文。 */
  files: Record<string, string>;
  /** 本应用已有的提供方（撞名判断 + 内置 apiKeyEnv 取值）。 */
  providers: ProviderInfo[];
  /** 内置 DeepSeek 的密钥 ref（来自引擎命名空间，勿猜）。 */
  deepseekApiKeyEnv: string;
  /** 已存在的自定义路由 id（llm-pi-ai.providers 的键）。 */
  existingRoutes: string[];
  /** 引擎可声明的协议（来自 settings schema；空表 = 本例不提供路由导入）。 */
  protocols: string[];
}

/** 引擎 route id 规则（与 ModelDialog.isRouteId 同源；这里再校验一次是因为 id 由
 *  来源名字派生，不是用户敲的）。 */
const isRouteId = (id: string) => /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/.test(id);

/** 名字 → 路由 id：小写、非字母数字转 `-`、折叠、去首尾。 */
export function routeIdFromName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** JSONC → JSON：字符串字面量之外的行注释与块注释剥掉。只做这一件事；解析失败由
 *  调用方按"该来源不支持"处理（不猜、不半解析）。 */
export function stripJsonComments(text: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\") { out += next ?? ""; i += 2; continue; }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; i += 1; continue; }
    if (ch === "/" && next === "/") { while (i < text.length && text[i] !== "\n") i += 1; continue; }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function parseConfig(text: string): Record<string, unknown> | null {
  for (const candidate of [text, stripJsonComments(text)]) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch { /* 换下一形态（原文 / 去注释） */ }
  }
  return null;
}

const hostOf = (baseURL: string): string => {
  try { return new URL(baseURL).host; } catch { return ""; }
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/** 唯一路由 id：撞名（内置提供方或已存在路由）时追加序号——与建项目同一规矩。 */
function uniqueRouteId(base: string, taken: Set<string>): string | null {
  const slug = routeIdFromName(base);
  if (!slug || !isRouteId(slug)) return null;
  if (!taken.has(slug)) return slug;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${slug}-${n}`;
    if (isRouteId(candidate) && !taken.has(candidate)) return candidate;
  }
  return null;
}

/** 内置提供方在本应用里的密钥 ref（取命名空间 apiKeyEnv，不猜）。 */
function refOfBuiltin(providerId: string, input: PlanInput): string | null {
  if (!input.providers.some((p) => p.provider === providerId)) return null;
  return keyRefOf(providerId, input.deepseekApiKeyEnv);
}

/** 解析 + 映射出导入计划。纯函数：只读输入、只算不写。 */
export function planModelImport(input: PlanInput): ModelImportPlan {
  const plan: ModelImportPlan = { items: [], notes: [] };
  const note = (source: string, label: string, reason: string) => plan.notes.push({ source, label, reason });
  const taken = new Set<string>([...input.providers.map((p) => p.provider), ...input.existingRoutes]);

  const addProvider = (args: {
    source: string;
    label: string;
    baseURL: string;
    kind: string;
    key: string;
    models: NonNullable<PiProviderProfile["models"]>;
    /** 来源没有端点（opencode）时用来源 id 表直接指到内置提供方。 */
    providerIdHint?: string;
  }): void => {
    const { source, label, baseURL, kind, key, models } = args;
    if (!key) { note(source, label, tt("没有可用的密钥", "no usable key")); return; }
    const builtinId = args.providerIdHint ?? BUILTIN_BY_HOST[hostOf(baseURL)];
    if (builtinId) {
      const ref = refOfBuiltin(builtinId, input);
      if (!ref) { note(source, label, tt("本应用没有这个内置提供方", "the app has no such built-in provider")); return; }
      plan.items.push({ source, label, providerId: builtinId, ref, key });
      return;
    }
    if (!baseURL) { note(source, label, tt("配置里没有端点地址，无法建自定义提供方", "no endpoint in this config; cannot create a custom provider")); return; }
    // 两种写法都认：来源自己的叫法（zcode 的 anthropic / openai-compatible）经表映射；
    // 来源直接写的引擎协议值（pi 的 api 字段）原样接受。
    const api = PROTOCOL_BY_KIND[kind]
      ?? (input.protocols.includes(kind) ? (kind as Protocol) : undefined);
    if (!api) { note(source, label, tt("协议「{k}」不在可映射范围内", "protocol \"{k}\" cannot be mapped", { k: kind })); return; }
    if (!input.protocols.includes(api)) { note(source, label, tt("引擎未提供该协议的可声明面", "the engine does not expose this protocol")); return; }
    const routeId = uniqueRouteId(label, taken);
    if (!routeId) { note(source, label, tt("无法生成合法的路由 id", "cannot derive a valid route id")); return; }
    if (models.length === 0) { note(source, label, tt("没有可用的模型清单", "no usable model list")); return; }
    taken.add(routeId);
    plan.items.push({
      source, label, routeId, baseURL, api, models,
      ref: keyRefOf(routeId, input.deepseekApiKeyEnv), key,
    });
  };

  // ── zcode：provider.<id>{ name, kind, options{apiKey,baseURL}, models{<id>:{limit,modalities}} }
  if (input.files.zcode) {
    const zcode = parseConfig(input.files.zcode);
    if (!zcode) note("zcode", "config.json", tt("配置解析失败", "config could not be parsed"));
    for (const [id, raw] of Object.entries(obj(zcode?.provider))) {
      const p = obj(raw);
      const options = obj(p.options);
      const models = Object.entries(obj(p.models)).map(([modelId, m]) => {
        const limit = obj(obj(m).limit);
        const inputKinds = Array.isArray(obj(obj(m).modalities).input)
          ? (obj(obj(m).modalities).input as unknown[]).map(str).filter(Boolean) : [];
        return {
          id: modelId,
          name: modelId,
          ...(typeof limit.context === "number" ? { contextWindow: limit.context } : {}),
          ...(typeof limit.output === "number" ? { maxTokens: limit.output } : {}),
          ...(inputKinds.length ? { input: inputKinds } : {}),
        };
      });
      addProvider({
        source: "zcode", label: str(p.name) || id, baseURL: str(options.baseURL),
        kind: str(p.kind), key: str(options.apiKey), models,
      });
    }
  }

  // ── mimocode：provider.<id>{ name, npm, options{apiKey,baseURL} }
  if (input.files.mimocode) {
    const mimocode = parseConfig(input.files.mimocode);
    if (!mimocode) note("mimocode", "mimocode.jsonc", tt("配置解析失败", "config could not be parsed"));
    for (const [id, raw] of Object.entries(obj(mimocode?.provider))) {
      const p = obj(raw);
      const options = obj(p.options);
      // npm 包名 → 协议：只认这两种（别的包名不猜）。
      const npm = str(p.npm);
      const kind = npm.endsWith("anthropic") ? "anthropic" : npm.endsWith("openai-compatible") ? "openai-compatible" : "";
      addProvider({
        source: "mimocode", label: str(p.name) || id, baseURL: str(options.baseURL),
        kind, key: str(options.apiKey),
        // 来源没给模型元数据；命中内置（DeepSeek）时不需要它，自定义端点则会被上面的
        // tt("没有可用的模型清单", "no usable model list")如实挡下。
        models: [],
      });
    }
  }

  // ── pi：providers.<id>{ baseUrl, api（已是引擎协议值）, apiKey, models[] }
  if (input.files.pi) {
    const pi = parseConfig(input.files.pi);
    if (!pi) note("pi", "models.json", tt("配置解析失败", "config could not be parsed"));
    for (const [id, raw] of Object.entries(obj(pi?.providers))) {
      const p = obj(raw);
      const models = (Array.isArray(p.models) ? p.models : []).flatMap((m) => {
        const meta = obj(m);
        const modelId = str(meta.id);
        if (!modelId) return [];
        return [{
          id: modelId,
          name: str(meta.name) || modelId,
          ...(typeof meta.contextWindow === "number" ? { contextWindow: meta.contextWindow } : {}),
          ...(typeof meta.maxTokens === "number" ? { maxTokens: meta.maxTokens } : {}),
          ...(Array.isArray(meta.input) ? { input: (meta.input as unknown[]).map(str).filter(Boolean) } : {}),
        }];
      });
      addProvider({
        source: "pi", label: str(p.name) || id, baseURL: str(p.baseUrl),
        kind: str(p.api), key: str(p.apiKey), models,
      });
    }
  }

  // ── opencode：auth.json{ <provider>{ type, key } }——没有任何端点信息
  if (input.files.opencode) {
    const opencode = parseConfig(input.files.opencode);
    if (!opencode) note("opencode", "auth.json", tt("配置解析失败", "config could not be parsed"));
    for (const [id, raw] of Object.entries(opencode ?? {})) {
      addProvider({
        source: "opencode", label: id, baseURL: "", kind: "",
        key: str(obj(raw).key), models: [],
        providerIdHint: BUILTIN_BY_SOURCE_ID.opencode?.[id],
      });
    }
  }

  return plan;
}

export interface AppliedImport {
  /** 成功落库的展示名（按来源顺序）。 */
  imported: string[];
  failed: Array<{ label: string; reason: string }>;
}

/** 落库：内置提供方只写密钥；自定义路由写 profile（+密钥）。写完必须 re-describe
 *  校验（坏 profile 会被引擎静默丢掉整段），没落上的路由回滚并把原因交给界面。 */
export async function applyModelImport(plan: ModelImportPlan): Promise<AppliedImport> {
  const imported: string[] = [];
  const failed: Array<{ label: string; reason: string }> = [];
  const routes = plan.items.filter((item) => item.routeId);
  const keyOnly = plan.items.filter((item) => !item.routeId);

  for (const item of keyOnly) {
    try {
      await api.credentialsSet({ ref: item.ref, value: item.key });
      imported.push(item.label);
    } catch (err) {
      failed.push({ label: item.label, reason: (err as Error).message });
    }
  }

  if (routes.length > 0) {
    try {
      await writeNamespaceOnce(
        "llm-pi-ai",
        tt("引擎未提供 llm-pi-ai 命名空间，无法导入自定义提供方", "The engine exposes no llm-pi-ai namespace; custom providers cannot be imported"),
        async (entry) => {
          const current = obj(entry.value);
          const providers = { ...obj(current.providers) };
          for (const item of routes) {
            providers[item.routeId as string] = {
              apiKeyEnv: item.ref,
              displayName: item.label,
              api: item.api,
              baseURL: item.baseURL,
              models: item.models ?? [],
            } satisfies PiProviderProfile;
          }
          await api.settingsUpdate({
            ns: "llm-pi-ai",
            patch: { ...current, providers },
            expectedRevision: entry.revision,
          });
        },
      );
      // 写后校验：整段还在、每条路由真的落上（引擎丢弃配置时这里是唯一的哨兵）。
      const after = await api.settingsDescribe();
      const ns = (after.namespaces ?? []).find((n) => n.ns === "llm-pi-ai");
      const landedProviders = obj(obj(ns?.value).providers);
      for (const item of routes) {
        if (landedProviders[item.routeId as string] === undefined) {
          failed.push({
            label: item.label,
            reason: tt("引擎未接受该提供方配置（写后校验未通过）", "The engine did not accept this provider config (post-write check failed)"),
          });
          continue;
        }
        try {
          await api.credentialsSet({ ref: item.ref, value: item.key });
          imported.push(item.label);
        } catch (err) {
          failed.push({ label: item.label, reason: (err as Error).message });
        }
      }
    } catch (err) {
      for (const item of routes) failed.push({ label: item.label, reason: (err as Error).message });
    }
  }

  return { imported, failed };
}
