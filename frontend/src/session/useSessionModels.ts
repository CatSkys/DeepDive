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
    // alpha.2: session/models and llm/models are gone from the browser face —
    // the unified catalog loader (session/modelCatalog with rc.2 fallback)
    // provides both the options and the engine default selection.
    void (async () => {
      let options: ModelOption[] = [];
      try {
        const r = await api.modelOptions();
        options = r.options;
        setModels(options);
        // llm/models 兜底路径没有 default 字段——不能在这里提前 return，
        // 否则下面的 session.models（实时选择 + 思考强度元数据）永远不跑。
        if (r.default) {
          const hit = options.find((m) => m.provider === r.default!.provider && m.model === r.default!.model);
          setModelName(hit?.label ?? `${r.default!.provider} / ${r.default!.model}`);
        }
      } catch { /* engine booting */ }
      // The live per-session selection (when it differs from the default).
      // session.models 一次带回当前选择（含 reasoningEffort）与分组目录
      // （含各模型的 reasoning 档位元数据），无需第二次调用。
      try {
        const r = await api.sessionModels({ sessionId });
        const cur = r.current;
        if (cur?.model) {
          const hit = options.find((m) => m.provider === cur.provider && m.model === cur.model);
          setModelName(hit?.label ?? cur.model);
        }
        if (cur?.provider && cur?.model) setCurrentModel({ provider: cur.provider, model: cur.model });
        setEffort(cur?.reasoningEffort ?? undefined);
        const group = (r.groups ?? []).find((g) => g.id === cur?.provider);
        const model = group?.models?.find((m) => m.id === cur?.model);
        setEffortLevels(model?.reasoning?.efforts ?? []);
        // 分组目录里每个模型自带 reasoning 档位元数据 —— 并进选项，
        // 模型菜单据此决定"点了直接选"还是"进档位滑杆页"。
        const effortByModel = new Map<string, { efforts: Array<{ id: string; name: string }>; defaultEffort?: string }>();
        for (const g of r.groups ?? []) {
          for (const m of g.models ?? []) {
            if (m.reasoning?.efforts?.length) {
              effortByModel.set(`${g.id}/${m.id}`, { efforts: m.reasoning.efforts, defaultEffort: m.reasoning.defaultEffort });
            }
          }
        }
        setModels(options.map((o) => {
          const meta = effortByModel.get(`${o.provider}/${o.model}`);
          return meta ? { ...o, efforts: meta.efforts, defaultEffort: meta.defaultEffort } : o;
        }));
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
