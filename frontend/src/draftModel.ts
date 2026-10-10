// 「上次选择」的持久化编解码：模型（含思考强度）落 localStorage，下次新建会话
// 继承上次选择而非回退引擎默认。桥端口已固定（PITFALLS §4.17），localStorage 跨
// 启动稳定——同 deepdive.workspace。
//
// **写入方有两处，都在用户改模型/档位时**：草稿页（App.tsx 的 heroFace）与已有会话里
// （session/useSessionModels 的 pickModel/pickEffort）。只写前者曾是 bug：在会话里换
// 了模型，新会话照旧是老的（用户 2026-10-10 报障）。"上次选择"不区分在哪改的。
// 只管编解码、边界校验与 hero 生效模型口径；状态持有在 store.tsx。
import type { ModelOption } from "./components/ModelMenu";

export type DraftModel = { provider: string; model: string; reasoningEffort?: string };

export const DRAFT_MODEL_KEY = "deepdive.draftModel";

/** 边界校验：provider/model 缺一或类型不对 → null（值损坏等同无草稿）。 */
export function parseDraftModel(raw: unknown): DraftModel | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.provider !== "string" || typeof r.model !== "string") return null;
  return {
    provider: r.provider,
    model: r.model,
    ...(typeof r.reasoningEffort === "string" ? { reasoningEffort: r.reasoningEffort } : {}),
  };
}

export function readDraftModel(): DraftModel | null {
  try {
    const raw = localStorage.getItem(DRAFT_MODEL_KEY);
    return raw === null ? null : parseDraftModel(JSON.parse(raw));
  } catch { /* corrupt localStorage value → 无草稿 */ }
  return null;
}

export function writeDraftModel(m: DraftModel | null): void {
  localStorage.setItem(DRAFT_MODEL_KEY, JSON.stringify(m));
}

/** hero（草稿页）头部生效的模型面：草稿选择优先，尚无草稿或草稿已不在目录
 *  （配置撤销）时跟引擎默认——与真会话 modelSelection 投影（next ?? lastUsed）
 *  同口径，思考强度标签因此不依赖用户手选过模型。 */
export function heroModelFace(
  models: ModelOption[],
  draft: DraftModel | null,
  engineDefault?: { provider: string; model: string },
): { currentModel?: { provider: string; model: string }; efforts: Array<{ id: string; name: string }>; effort?: string } {
  const draftOption = draft ? models.find((m) => m.provider === draft.provider && m.model === draft.model) : undefined;
  const option = draftOption ?? models.find((m) => m.provider === engineDefault?.provider && m.model === engineDefault?.model);
  return {
    currentModel: option ? { provider: option.provider, model: option.model } : undefined,
    efforts: option?.efforts ?? [],
    // 生效档位 = 草稿自己选的那一档 ?? 目录里该模型的 defaultEffort。后半段与引擎
    // resolveCallConfig 的 `requested ?? reasoning.defaultEffort` 同一条规则——目录说
    // 默认是 high 就是 high 生效，不是"一个叫 Default 的档位"（用户 2026-10-09 定稿）。
    // 草稿失效时不能拿旧档位贴到别的模型上，所以旧档位只在 draftOption 命中时用。
    effort: draftOption ? draft?.reasoningEffort ?? option?.defaultEffort : option?.defaultEffort,
  };
}
