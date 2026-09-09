// 模型目录数据源（设置页 ModelsManage 与首启引导 FirstRunGate 共用，唯一拷贝）：
// llm/listConfigurableProviders 目录 + settings 的 llm-deepseek / llm-pi-ai 两命名空间 +
// 各提供方密钥配置态（credentials.describe 实况）。
// 语义红线：「是否已配置」只认读取成功的结果——引擎瞬断/读失败时
// configuredKnown=false，调用方不得把"读不出配置"冒充成"未配置"
//（首启门据此防止把密钥已配好的老用户锁进引导页）。
import { useCallback, useState } from "react";
import { api } from "../api";
import { tt } from "../i18n";
import {
  keyRefOf,
  type DeepseekNs,
  type PiNs,
  type PiProviderProfile,
  type ProviderInfo,
} from "./ModelDialog";

export interface ModelCatalog {
  providers: ProviderInfo[];
  deepseek: DeepseekNs;
  pi: PiNs;
  /** keyRef → 密钥已配置（最近一次读取成功的 describe 实况）。 */
  credentials: Record<string, boolean>;
  /** 首轮 reload 结束（成功或失败，失败看 loadError）。 */
  ready: boolean;
  loadError: string | null;
  /** 目录读取成功且密钥态读取成功——只有此刻「全部未配置」才是可信结论。 */
  configuredKnown: boolean;
  anyConfigured: boolean;
  /** 重拉目录与密钥态；resolve 值 = 本轮读取到的「是否存在已配置密钥」
   *  （读取失败 resolve false——调用方只拿它决定"保存后要不要重开表单"）。 */
  reload: () => Promise<boolean>;
}

export function useModelCatalog(): ModelCatalog {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [deepseek, setDeepseek] = useState<DeepseekNs>({ apiKeyEnv: "DEEPSEEK_API_KEY", models: [] });
  const [pi, setPi] = useState<PiNs>({ providers: {} });
  const [credentials, setCredentials] = useState<Record<string, boolean>>({});
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [configuredKnown, setConfiguredKnown] = useState(false);

  const reload = useCallback(async (): Promise<boolean> => {
    setLoadError(null);
    try {
      const [provs, d] = await Promise.all([
        api.llmProviders().catch(() => [] as ProviderInfo[]),
        api.settingsDescribe(),
      ]);
      const deepNs = (d.namespaces ?? []).find((n) => n.ns === "llm-deepseek");
      const piNs = (d.namespaces ?? []).find((n) => n.ns === "llm-pi-ai");
      const deepVal = (deepNs?.value ?? {}) as {
        apiKeyEnv?: string;
        models?: Array<{ id: string; name?: string; contextWindow?: number; inputModalities?: string[] }>;
      };
      const piVal = (piNs?.value ?? {}) as { providers?: Record<string, PiProviderProfile> };
      const apiKeyEnv = deepVal.apiKeyEnv ?? "DEEPSEEK_API_KEY";
      // llm/listConfigurableProviders 只给可配置面；「用户手写落盘」以
      // llm-pi-ai 里存在该提供方 profile 为准（组级删除入口的判定语义）。
      const list: ProviderInfo[] = provs.map((p) => ({
        ...p,
        active: true,
        declared: (piVal.providers ?? {})[p.provider] !== undefined,
      }));
      setProviders(list);
      setDeepseek({ apiKeyEnv, models: deepVal.models ?? [] });
      setPi({ providers: piVal.providers ?? {} });
      setReady(true);

      // 密钥配置态：读成功才确证（refs 为空 = 目录异常，同样不算确证）。
      let any = false;
      const refs = [...new Set(list.map((p) => keyRefOf(p.provider, apiKeyEnv)))];
      if (refs.length > 0) {
        try {
          const cr = await api.credentialsDescribe({ refs });
          const configured: Record<string, boolean> = {};
          for (const [ref, c] of Object.entries(cr.credentials ?? {})) {
            configured[ref] = !!c?.configured;
            if (configured[ref]) any = true;
          }
          setCredentials(configured);
          setConfiguredKnown(true);
          return any;
        } catch { /* 引擎不可达：密钥态未知，不冒充结论 */ }
      }
      setConfiguredKnown(false);
      return false;
    } catch (err) {
      setConfiguredKnown(false);
      setReady(true);
      setLoadError(tt("读取失败：{m}", "Read failed: {m}", { m: (err as Error).message }));
      return false;
    }
  }, []);

  const anyConfigured = Object.values(credentials).some(Boolean);
  return {
    providers, deepseek, pi, credentials,
    ready, loadError, configuredKnown, anyConfigured,
    reload,
  };
}
