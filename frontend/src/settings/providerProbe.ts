// 提供方密钥/连通性探测的唯一实现（设置→模型的「测试连通」与新手引导的「保存并测试」
// 共用；此前只有前者那一份，引导卡要用就得复制——按"同一功能不留第二份拷贝"抽到这里）。
//
// 两条探测路径（引擎能力决定的，不是偏好）：
//  · 有发现路由的提供方（llm-pi-ai 自定义路由）：`llm/discoverModels` 列出模型 =
//    连通且密钥有效；预置路由（引擎安装目录之外的整条声明）要捎上它自己的端点与协议
//    ——引擎不会替手写路由猜端点。
//  · 内置 DeepSeek 没有发现路由：退化为 `credentials/describe` 的密钥配置状态检查。
import { api } from "../api";
import { tt } from "../i18n";
import { keyRefOf } from "./ModelDialog";
import { presetRouteDraft } from "./presetProviders";

export interface ProbeResult {
  ok: boolean;
  /** 人读结果（已本地化），失败时是引擎/网络的报错原文（截断）。 */
  message: string;
}

export async function probeProvider(args: {
  provider: string;
  /** 内置 DeepSeek 的密钥 ref 来源（llm-deepseek 命名空间的 apiKeyEnv）。 */
  deepseekApiKeyEnv: string;
}): Promise<ProbeResult> {
  const { provider, deepseekApiKeyEnv } = args;
  try {
    if (provider === "deepseek-official") {
      const ref = keyRefOf(provider, deepseekApiKeyEnv);
      const cr = await api.credentialsDescribe({ refs: [ref] });
      const ok = !!cr?.[ref]?.configured;
      return { ok, message: ok ? tt("密钥已配置", "Key configured") : tt("未配置密钥", "No key configured") };
    }
    const draft = presetRouteDraft(provider);
    const models = await api.discoverModels({ settingsNs: "llm-pi-ai", ...(draft ?? { provider }) });
    return { ok: true, message: tt("连通 · {n} 个模型", "Connected · {n} models", { n: models.length }) };
  } catch (err) {
    return { ok: false, message: String((err as Error).message).slice(0, 140) };
  }
}
