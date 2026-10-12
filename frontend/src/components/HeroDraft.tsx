// 草稿页（hero）：新会话未落库前的整页——头部模型/档位选择（草稿模型=持久化的
// 「上次选择」，首条消息建会话时随 selectModel 带走）、品牌问候、输入区、会话设置
// 卡。主窗与迷你面板页（#/mini）共用这一份；数据不在这里落，发送链走 Composer。

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { ModelOption } from "./ModelMenu";
import { withFacts } from "../modelFacts";
import { HeroPanel, HeroPanelTrigger } from "../sidebar-right/HeroPanel";
import { HeroBrand } from "./HeroBrand";
import { Composer } from "./Composer";
import { SessionHeader, type ModelFace } from "../session/SessionHeader";
import type { EffortFace } from "./composer/EffortPicker";
import { heroModelFace } from "../draftModel";
import { useStore } from "../store";
import { useT } from "../i18n";

export function HeroDraft() {
  const store = useStore();
  const { t } = useT();
  const [modelName, setModelName] = useState("DeepSeek");
  const [models, setModels] = useState<ModelOption[]>([]);
  // 引擎默认模型（modelCatalog 的 default）：草稿无选择/草稿失效时 hero 头部
  // 的显示口径——真会话走 modelSelection 投影（next ?? lastUsed），hero 与它对齐。
  const [engineDefault, setEngineDefault] = useState<{ provider: string; model: string } | undefined>(undefined);
  const [showModels, setShowModels] = useState(false);
  /** 草稿页的右侧边栏卡（只有会话设置，无会话可读所以没有状态分区）。 */
  const [heroPanelOpen, setHeroPanelOpen] = useState(false);

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
  // hero 头部的模型名/思考档位不必等用户开菜单才纠正（重启后显示默认模型）。
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

  // 草稿页生效模型（草稿 ?? 引擎默认的口径在 draftModel.ts）：hero 头部显示
  // 与菜单共用，档位元数据来自目录里的 efforts（modelCatalog 透传）。
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

  // 草稿页的模型面：头部那一行与会话设置卡共用同一份（同一目录、同一草稿选择，
  // 两处各写一遍字面量会漂移——其中一处改了 modelName 另一处就不跟着）。档位三件套
  // 同源（heroModel/pickDraftEffort），会话设置卡的「思考强度」行从这里取。
  const heroFace: ModelFace = {
    showModels, setShowModels, modelName, models,
    currentModel: heroModel.currentModel,
    pickModel,
    effortLevels: heroModel.efforts,
    effort: heroModel.effort,
    pickEffort: pickDraftEffort,
  };
  // 草稿页的思考强度面（输入框胶囊用）：档位表来自目录里当前生效模型的
  // reasoning 元数据，当前档位只认草稿自己的（见 draftModel.ts heroModelFace）。
  const heroEffort: EffortFace = { levels: heroModel.efforts, value: heroModel.effort, pick: pickDraftEffort };

  return (
    <div className="session-row">
      <div className="hero">
        {/* 草稿页右上角的右边栏入口：会话页那颗 PanelTrigger 的同款同位置
            （绝对定位挂在卡片上，与会话头的右 16 / 上 8 对齐）。 */}
        <HeroPanelTrigger open={heroPanelOpen} onToggle={() => setHeroPanelOpen((v) => !v)} />
        <div className="hero-top">
          {/* 草稿选择（draftModel）派生头部模型与思考档位显示——档位元
              数据来自 models 里的 efforts（modelOptions 透传）。标题点击 =
              弹出右侧的会话设置卡（与会话页标题同一条规则）。 */}
          <SessionHeader title={t("新会话")} face={heroFace} onTitleClick={() => setHeroPanelOpen(true)} />
        </div>
        <HeroBrand />
        <div className="hero-composer">
          <Composer sessionId={null} effort={heroEffort} />
        </div>
      </div>
      <HeroPanel
        open={heroPanelOpen}
        onClose={() => setHeroPanelOpen(false)}
        reloadModels={reloadModels}
        face={heroFace}
      />
    </div>
  );
}
