// 会话头部（R-008/X1-3 从三处复制收敛为唯一实现）：标题行（title +
// WorkspacePill）+ 模型触发器（含思考强度标签）+ ModelMenu。模型面数据由
// 调用方经 face 传入——SessionView 用 useSessionModels 的返回值，App 的
// hero 态用自有目录/选模型逻辑（pickModel 带建会话兜底，合同不同）。
import { ChevronDown } from "lucide-react";
import { ModelMenu, type ModelOption } from "../components/ModelMenu";
import { WorkspacePill } from "../components/Sidebar";

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
  return (
    <div className="left">
      <div className="title-row">
        <div className="title">{title}</div>
        <WorkspacePill />
      </div>
      <button className="model trigger" data-open={face.showModels ? "true" : "false"} onClick={() => face.setShowModels(true)}>
        {face.modelName || "Auto"}
        {face.effortLevels.length > 0 && <span className="effort-tag">{face.effortLabel(face.effort)}</span>}
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
