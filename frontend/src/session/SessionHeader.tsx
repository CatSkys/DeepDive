// 会话头部（R-008/X1-3 从三处复制收敛为唯一实现）：标题行（title +
// WorkspacePill）+ 模型触发器 + ModelMenu。模型面数据由调用方经 face 传入——
// SessionView 用 useSessionModels 的返回值，App 的 hero 态用自有目录/选模型
// 逻辑（pickModel 带建会话兜底，合同不同）。
// 标题本身是右侧面板「会话设置」的入口（onTitleClick，用户定稿）。
// 思考强度不在这里：档位是输入框自己的控件（components/composer/EffortPicker.tsx），
// 与模型选择分开（用户 2026-10-09 定稿）。
import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { ModelMenu, type ModelOption } from "../components/ModelMenu";
import { WorkspacePill } from "../components/Sidebar";
import { ProjectMenu } from "../components/ProjectMenu";
import { useStore } from "../store";

export interface ModelFace {
  showModels: boolean;
  setShowModels: (v: boolean) => void;
  modelName: string;
  models: ModelOption[];
  currentModel?: { provider: string; model: string };
  pickModel: (m: ModelOption) => void | Promise<void>;
}

export function SessionHeader({ title, face, onTitleClick }: { title: string; face: ModelFace; onTitleClick?: () => void }) {
  const { sidebarCollapsed } = useStore();
  // 项目切换选框（侧栏收起时点项目胶囊弹出——标题点击已改道面板的会话设置；
  // 展开态项目名在侧栏常驻，不弹）
  const [projOpen, setProjOpen] = useState(false);
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="left">
      <div className="title-row">
        <span className="title-anchor">
          {/* role=button：顶栏 52px 条带的点击穿透白名单按它放行（titlebar.ts
              INTERACTIVE），否则标题点击被壳当拖窗吞掉（PITFALLS §4.3）。
              无 onTitleClick 的挂点（空白会话分支没有面板）不装成按钮。 */}
          <div
            className={`title${onTitleClick ? " title-switch" : ""}`}
            {...(onTitleClick ? { role: "button" as const } : {})}
            onClick={onTitleClick}
          >
            {title}
          </div>
          {projOpen && <ProjectMenu onClose={() => setProjOpen(false)} />}
        </span>
        <WorkspacePill onOpen={sidebarCollapsed ? () => setProjOpen((v) => !v) : undefined} />
      </div>
      <button ref={modelTriggerRef} className="model trigger" data-open={face.showModels ? "true" : "false"} onClick={() => face.setShowModels(true)}>
        {face.modelName || "Auto"}
        <ChevronDown size={12} className="trigger-chev" />
      </button>
      {face.showModels && (
        <ModelMenu
          options={face.models}
          current={face.modelName}
          currentModel={face.currentModel}
          onPick={(m) => void face.pickModel(m)}
          onClose={() => face.setShowModels(false)}
          anchorRef={modelTriggerRef}
        />
      )}
    </div>
  );
}
