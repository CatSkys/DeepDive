// 模型面 hook（R-007 从 SessionView 搬出）：统一模型目录加载
// （session/modelCatalog + rc.2 llm/models 兜底 + session/models 实时选择与
// 思考强度元数据并轨）、选模型 / 改档位的提交。不管渲染。
//
// 选模型与思考强度是两条独立的写路（用户 2026-10-09 定稿）：模型菜单只提交
// provider/model，档位由输入框上的档位胶囊提交；两条都走同一个
// session/selectModel RPC（引擎的 durable 选择是「模型 + 可选档位」一份整体）。
import { useEffect, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { withFacts } from "../modelFacts";
import type { ModelOption } from "../components/ModelMenu";

export function useSessionModels(sessionId: string) {
  const store = useStore();
  const [modelName, setModelName] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [showModels, setShowModels] = useState(false);
  // 思考强度（推理档位）：随所选模型的能力元数据出现，无 reasoning 元数据的
  // 模型不显示档位。effort === undefined 表示跟随提供商默认档。
  const [currentModel, setCurrentModel] = useState<{ provider: string; model: string } | undefined>(undefined);
  const [effortLevels, setEffortLevels] = useState<Array<{ id: string; name: string }>>([]);
  const [effort, setEffort] = useState<string | undefined>(undefined);

  // `engineUp` 进依赖是**必须的**，不是顺手加的：冷启动与引擎重启的窗口里
  // `api.modelOptions()` 会抛（引擎未就绪），两个 catch 都留空——不重拉的话这个会话
  // 的档位表就一直是空表，输入框的档位胶囊整场都不出现（用户 2026-10-14 报「思考强度
  // 的开关怎么没了」，`make deliver` 重启后撞的正是这个窗口）。草稿页
  // （useDraftModelFace）与导入页早就是"engineUp 翻真再拉一次"的口径，这里是同一件事
  // 的第三个落点；翻假那一次只是两条注定失败的请求，catch 自己吞掉，界面不会闪。
  useEffect(() => {
    // 0.1.2：session/modelCatalog 是唯一目录面（含默认选择与各模型 reasoning
    // 档位元数据）；会话的实时选择读 modelSelection 投影（next ?? lastUsed）。
    void (async () => {
      let options: ModelOption[] = [];
      try {
        const r = await api.modelOptions();
        // 基准刻度 join（modelFacts 登记表）；未收录的模型原样透传。
        options = withFacts(r.options);
        setModels(options);
        if (r.default) {
          const hit = options.find((m) => m.provider === r.default!.provider && m.model === r.default!.model);
          setModelName(hit?.label ?? `${r.default!.provider} / ${r.default!.model}`);
        }
      } catch { /* engine booting */ }
      try {
        const list = await api.sessions();
        const proj = list.items.find((s) => s.sessionId === sessionId)
          ?.projections?.values?.modelSelection as { next?: { provider: string; model: string; reasoningEffort?: string } | null; lastUsed?: { provider: string; model: string; reasoningEffort?: string } | null } | undefined;
        const cur = proj?.next ?? proj?.lastUsed ?? undefined;
        if (cur?.model) {
          const hit = options.find((m) => m.provider === cur.provider && m.model === cur.model);
          setModelName(hit?.label ?? cur.model);
        }
        if (cur?.provider && cur?.model) setCurrentModel({ provider: cur.provider, model: cur.model });
        const hit = options.find((m) => m.provider === cur?.provider && m.model === cur?.model);
        setEffortLevels(hit?.efforts ?? []);
        // 生效档位 = 会话选的那一档 ?? 目录里该模型的 defaultEffort（与引擎
        // resolveCallConfig 的 `requested ?? reasoning.defaultEffort` 同一规则）。
        // 没有"Default"这一档——用户 2026-10-09 定稿"是啥档位就显示啥档位"。
        setEffort(cur?.reasoningEffort ?? hit?.defaultEffort ?? undefined);
      } catch { /* optional enrichment */ }
    })();
  }, [sessionId, store.engineUp]);

  /** 切模型：只提交 provider/model。档位不跟着走——引擎按 resolveCallConfig 归一
   *  （省略档位＝该模型的适配器默认档，可能物化成一个具体 id），所以档位显示取
   *  引擎返回的 selected，不在本地猜「没传就是 Default」。
   *
   *  **「上次选择」在这里跟着走**：新会话的模型取自 store.draftModel，而它此前只在
   *  草稿页选模型时才写——于是"在会话里换了模型，新会话却还是老的那个"（用户
   *  2026-10-10 报障）。模型选择在哪发生都是同一次"上次选择"，所以两处都写。
   *  真有差别的只有"草稿页还没有会话"这一点，不是写不写的理由。 */
  const pickModel = async (m: ModelOption) => {
    const prev = { label: modelName, current: currentModel, effort, levels: effortLevels };
    setModelName(m.label);
    setCurrentModel({ provider: m.provider, model: m.model });
    setEffortLevels(m.efforts ?? []);
    try {
      const res = await api.selectModel({ sessionId, provider: m.provider, model: m.model });
      setEffort(res.selected.reasoningEffort);
      store.setDraftModel({
        provider: m.provider, model: m.model,
        ...(res.selected.reasoningEffort === undefined ? {} : { reasoningEffort: res.selected.reasoningEffort }),
      });
    } catch {
      // 提交失败：引擎侧选择未变，乐观更新回滚为前值（AUD-086）
      setModelName(prev.label);
      setCurrentModel(prev.current);
      setEffort(prev.effort);
      setEffortLevels(prev.levels);
    }
  };

  /** 改档位：模型不动，只换该会话的推理档位（输入框档位胶囊的写路）。 */
  const pickEffort = async (id: string) => {
    if (!currentModel) return;
    const prev = effort;
    setEffort(id);
    try {
      await api.selectModel({ sessionId, provider: currentModel.provider, model: currentModel.model, reasoningEffort: id });
      // 档位也是"上次选择"的一部分：不带过去的话，下个新会话会拿到别的档位
      store.setDraftModel({ provider: currentModel.provider, model: currentModel.model, reasoningEffort: id });
    } catch {
      setEffort(prev); // 提交失败回滚为前值（引擎侧未变，同 AUD-086）
    }
  };

  return {
    showModels, setShowModels, modelName, models, currentModel,
    effortLevels, effort, pickModel, pickEffort,
  };
}
