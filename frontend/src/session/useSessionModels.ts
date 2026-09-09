// 模型面 hook（R-007 从 SessionView 搬出）：统一模型目录加载
// （session/modelCatalog + rc.2 llm/models 兜底 + session/models 实时选择与
// 思考强度元数据并轨）、选模型 / 应用档位的提交。不管渲染。
import { useEffect, useState } from "react";
import { api } from "../api";
import { effortDisplayName, type ModelOption } from "../components/ModelMenu";

export function useSessionModels(sessionId: string) {
  const [modelName, setModelName] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [showModels, setShowModels] = useState(false);
  // 思考强度（推理档位）：随所选模型的能力元数据出现，无 reasoning 元数据的
  // 模型不显示档位。effort === undefined 表示跟随提供商默认档。
  const [currentModel, setCurrentModel] = useState<{ provider: string; model: string } | undefined>(undefined);
  const [effortLevels, setEffortLevels] = useState<Array<{ id: string; name: string }>>([]);
  const [effort, setEffort] = useState<string | undefined>(undefined);

  useEffect(() => {
    // 0.1.2：session/modelCatalog 是唯一目录面（含默认选择与各模型 reasoning
    // 档位元数据）；会话的实时选择读 modelSelection 投影（next ?? lastUsed）。
    void (async () => {
      let options: ModelOption[] = [];
      try {
        const r = await api.modelOptions();
        options = r.options;
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
        setEffort(cur?.reasoningEffort ?? undefined);
        const hit = options.find((m) => m.provider === cur?.provider && m.model === cur?.model);
        setEffortLevels(hit?.efforts ?? []);
      } catch { /* optional enrichment */ }
    })();
  }, [sessionId]);

  const pickModel = async (m: ModelOption) => {
    // 菜单关闭由 ModelMenu 决定：无档位模型选完即关；带档位的进滑杆页，
    // 档位滑杆松手即通过 applyModelEffort 一次提交模型+档位后关闭。
    const prevLabel = modelName;
    setModelName(m.label);
    try {
      await api.selectModel({ sessionId, provider: m.provider, model: m.model });
    } catch {
      // 提交失败：引擎侧选择未变，乐观更新回滚为前值（AUD-086）
      setModelName(prevLabel);
    }
  };

  const effortLabel = (id: string | undefined) => effortDisplayName(id, effortLevels);

  const applyModelEffort = async (m: ModelOption, id: string | undefined) => {
    const prev = { label: modelName, current: currentModel, effort };
    setModelName(m.label);
    setCurrentModel({ provider: m.provider, model: m.model });
    setEffort(id);
    try {
      await api.selectModel({
        sessionId,
        provider: m.provider,
        model: m.model,
        ...(id === undefined ? {} : { reasoningEffort: id }),
      });
    } catch {
      // 提交失败：引擎侧选择未变，三个乐观更新一并回滚为前值（AUD-086）
      setModelName(prev.label);
      setCurrentModel(prev.current);
      setEffort(prev.effort);
    }
  };

  return {
    showModels, setShowModels, modelName, models, currentModel,
    effortLevels, effort, effortLabel, pickModel, applyModelEffort,
  };
}
