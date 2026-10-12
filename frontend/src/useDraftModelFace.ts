// 草稿页的模型 apparatus（hook）：目录加载（开菜单重拉 + engineUp 补拉）、模型与
// 思考档位选择、「上次选择」暂存（draftModel），输出头部模型面（SessionHeader /
// 会话设置卡共用）与输入框的思考强度面。主窗草稿页（HeroDraft）与迷你面板草稿页
// （MiniDraft）共用这一份；不落数据，首条消息建会话时由 store 随 selectModel 带走。

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { ModelOption } from "./components/ModelMenu";
import { withFacts } from "./modelFacts";
import { heroModelFace } from "./draftModel";
import { useStore } from "./store";
import type { ModelFace } from "./session/SessionHeader";
import type { EffortFace } from "./components/composer/EffortPicker";

export function useDraftModelFace(): { face: ModelFace; effort: EffortFace; reloadModels: () => void } {
  const store = useStore();
  const [modelName, setModelName] = useState("DeepSeek");
  const [models, setModels] = useState<ModelOption[]>([]);
  // 引擎默认模型（modelCatalog 的 default）：草稿无选择/草稿失效时头部显示口径
  // ——真会话走 modelSelection 投影（next ?? lastUsed），草稿页与它对齐。
  const [engineDefault, setEngineDefault] = useState<{ provider: string; model: string } | undefined>(undefined);
  const [showModels, setShowModels] = useState(false);

  // Model catalog: reloaded every time the picker opens — the catalog changes
  // when keys/providers are configured in settings, and a boot-time-only load
  // would stay empty forever after an early failure (user report).
  // 显示名跟「草稿选择」走：引擎 default 只是初始值，草稿页每次开菜单都
  // 重拉目录，若无视草稿会把已选模型重置回默认，表现为"无法切换"。
  const loadModels = useCallback(async () => {
    // 启动期引擎常未就绪（bridge 503）：目录留空降级，picker 打开时重拉
    //（上方注释的既有策略）；不捕获会成为 unhandledrejection 污染诊断通道。
    const { options, default: def } = await api.modelOptions()
      .catch(() => ({ options: [] as ModelOption[], default: undefined }));
    setModels(withFacts(options));
    setEngineDefault(def);
    const want = store.draftModel ?? def;
    if (want) {
      const hit = options.find((m) => m.provider === want.provider && m.model === want.model);
      if (hit) setModelName(hit.label);
    } else if (options[0]) setModelName(options[0].label);
  }, [store.draftModel]);
  useEffect(() => { void loadModels(); }, [loadModels]);
  // 冷启动挂载时常撞引擎 503（上方降级路径留空）：engineUp 翻真后补拉一次，
  // 头部的模型名/思考档位不必等用户开菜单才纠正（重启后显示默认模型）。
  useEffect(() => {
    if (store.engineUp) void loadModels();
  }, [store.engineUp, loadModels]);
  useEffect(() => {
    if (showModels) void loadModels();
  }, [showModels, loadModels]);
  // 传给草稿面板的同一个加载器：**必须是稳定引用**——面板把 identity 放进 effect
  // 依赖，每次渲染新建箭头会变成 fetch → setState → 重渲 → 再 fetch 的死循环
  // （i18n.ts 的 t/tt 缓存注释记过同型事故）。
  const reloadModels = useCallback(() => void loadModels(), [loadModels]);

  // 草稿页生效模型（草稿 ?? 引擎默认的口径在 draftModel.ts）。
  const heroModel = heroModelFace(models, store.draftModel, engineDefault);

  const pickModel = async (m: ModelOption) => {
    setModelName(m.label);
    // 只提交模型：档位是输入框那颗胶囊的事（components/composer/EffortPicker）。
    // 草稿页（hero）选模型：会话还没真正创建，暂存草稿，首条消息创建会话时
    // 由 store.createSession 随新会话 selectModel 带走——这里不建会话。
    if (!store.activeSessionId) {
      store.setDraftModel({ provider: m.provider, model: m.model });
      return;
    }
    try {
      await api.selectModel({ sessionId: store.activeSessionId, provider: m.provider, model: m.model });
    } catch { /* engine may be booting */ }
  };

  /** 草稿页改档位：写在草稿模型上；还没草稿（跟着引擎默认模型）就先按当前生效
   *  模型立一份草稿——首条消息建会话时随 selectModel 一起带走。 */
  const pickDraftEffort = (id: string) => {
    const base = store.draftModel ?? heroModel.currentModel;
    if (!base) return;
    store.setDraftModel({ provider: base.provider, model: base.model, reasoningEffort: id });
  };

  // 头部那一行与会话设置卡共用同一份模型面（同一目录、同一草稿选择，两处各写
  // 一遍字面量会漂移）；档位三件套同源，输入框胶囊从这里取。
  const face: ModelFace = {
    showModels, setShowModels, modelName, models,
    currentModel: heroModel.currentModel,
    pickModel,
    effortLevels: heroModel.efforts,
    effort: heroModel.effort,
    pickEffort: pickDraftEffort,
  };
  const effort: EffortFace = { levels: heroModel.efforts, value: heroModel.effort, pick: pickDraftEffort };
  return { face, effort, reloadModels };
}
