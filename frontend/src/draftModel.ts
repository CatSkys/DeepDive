// 草稿模型的持久化编解码：新会话页（hero）上选的模型（含思考强度）落
// localStorage，下次新建会话继承上次选择而非回退引擎默认。桥端口已固定
// （PITFALLS §4.17），localStorage 跨启动稳定——同 deepdive.workspace。
// 只管编解码、边界校验与 hero 生效模型口径；状态持有在 store.tsx，UI 消费在
// App.tsx heroFace。
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
    // 档位只认草稿自己的：默认模型显示 Default，草稿失效时不能拿旧档位贴到别的模型上
    effort: draftOption ? draft?.reasoningEffort : undefined,
  };
}
