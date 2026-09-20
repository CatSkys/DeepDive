// 引导卡内的**模型目录单例**：卡片自己创建一份 useModelCatalog，用 context 下发给各步。
//
// 为什么需要它：useModelCatalog 是自持状态的 hook（不是全局单例），每个调用方各拿一份。
// 卡片与「配置模型」步各持一份时，在步里保存密钥只刷新了那一份——卡片那一份的
// anyConfigured 永远为假，于是左栏"配置模型"永远不打勾（用户实测报的就是这个），
// 迁移步的计划也会用一份空目录去算。这里让卡片内只有一份，谁改谁 reload，全卡同步。
import { createContext, useContext, type ReactNode } from "react";
import type { ModelCatalog } from "../settings/useModelCatalog";

const Ctx = createContext<ModelCatalog | null>(null);

export function OnboardingCatalogProvider({ value, children }: { value: ModelCatalog; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 卡片内的目录实例；没有 provider 是接线错误（卡片必须自己包一层），直接报出来。 */
export function useOnboardingCatalog(): ModelCatalog {
  const value = useContext(Ctx);
  if (!value) throw new Error("useOnboardingCatalog must be used inside OnboardingCatalogProvider");
  return value;
}
