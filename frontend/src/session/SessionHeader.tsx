// 会话头部（R-008/X1-3 从三处复制收敛为唯一实现）：标题行（title +
// WorkspacePill）+ 模型触发器（含思考强度标签）+ ModelMenu。模型面数据由
// 调用方经 face 传入——SessionView 用 useSessionModels 的返回值，App 的
// hero 态用自有目录/选模型逻辑（pickModel 带建会话兜底，合同不同）。
// 思考强度切换快捷键（快捷键页可改）：监听 dd:cycle-effort，按当前档位
// 循环到下一档并经 applyModelEffort 提交；强度标签 tooltip 带键帽同步。
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { ModelMenu, type ModelOption } from "../components/ModelMenu";
import { WorkspacePill } from "../components/Sidebar";
import { ProjectMenu } from "../components/ProjectMenu";
import { PresetPill } from "../components/AgentMode";
import { useStore } from "../store";
import { comboFor } from "../keybinds";
import { useT } from "../i18n";
import { DD_EVENTS } from "../events";

export interface ModelFace {
  showModels: boolean;
  setShowModels: (v: boolean) => void;
  modelName: string;
  models: ModelOption[];
  currentModel?: { provider: string; model: string };
  effortLevels: Array<{ id: string; name: string }>;
  effort: string | undefined;
  effortLabel: (id: string | undefined) => string;
  pickModel: (m: ModelOption) => void | Promise<void>;
  applyModelEffort: (m: ModelOption, id: string | undefined) => void | Promise<void>;
}

export function SessionHeader({ title, face }: { title: string; face: ModelFace }) {
  const { keybinds, sidebarCollapsed } = useStore();
  const { t } = useT();
  // 项目切换选框（参考图 Create Project 顶栏样式，复用 Hero 项目菜单）：
  // 侧栏收起时点会话标题或项目胶囊弹出——侧栏展开时项目名在侧栏常驻，不弹
  const [projOpen, setProjOpen] = useState(false);
  // face（useSessionModels 每渲染返回新对象）镜像到 ref：监听只挂一次，
  // 触发时读现值——避免流式期渲染反复重挂（AUD-115）。
  const faceRef = useRef(face);
  faceRef.current = face;

  useEffect(() => {
    const onCycle = () => {
      const f = faceRef.current;
      const levels = f.effortLevels;
      const cur = f.models.find(
        (m) => m.provider === f.currentModel?.provider && m.model === f.currentModel?.model,
      );
      if (!cur || levels.length === 0) return;
      const idx = levels.findIndex((l) => l.id === f.effort);
      const next = levels[(idx + 1 + levels.length) % levels.length];
      void f.applyModelEffort(cur, next.id);
    };
    window.addEventListener(DD_EVENTS.cycleEffort, onCycle);
    return () => window.removeEventListener(DD_EVENTS.cycleEffort, onCycle);
  }, []);

  return (
    <div className="left">
      <div className="title-row">
        <span className="title-anchor">
          <div
            className={`title${sidebarCollapsed ? " title-switch" : ""}`}
            onClick={sidebarCollapsed ? () => setProjOpen((v) => !v) : undefined}
          >
            {title}
          </div>
          {projOpen && <ProjectMenu onClose={() => setProjOpen(false)} />}
        </span>
        <PresetPill />
        <WorkspacePill onOpen={sidebarCollapsed ? () => setProjOpen((v) => !v) : undefined} />
      </div>
      <button className="model trigger" data-open={face.showModels ? "true" : "false"} onClick={() => face.setShowModels(true)}>
        {face.modelName || "Auto"}
        {face.effortLevels.length > 0 && (
          <span className="effort-tag" data-tip={t("思考强度切换")} data-tip-keys={comboFor("cycle-effort", keybinds)}>
            {face.effortLabel(face.effort)}
          </span>
        )}
        <ChevronDown size={12} className="trigger-chev" />
      </button>
      {face.showModels && (
        <ModelMenu
          options={face.models}
          current={face.modelName}
          currentModel={face.currentModel}
          effortValue={face.effort}
          onPick={(m) => void face.pickModel(m)}
          onApplyEffort={(m, id) => void face.applyModelEffort(m, id)}
          onClose={() => face.setShowModels(false)}
        />
      )}
    </div>
  );
}
