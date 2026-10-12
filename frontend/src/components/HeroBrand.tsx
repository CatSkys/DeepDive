import { useRef, useState } from "react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { ProjectMenu } from "./ProjectMenu";
import { WorkspaceMenu } from "./WorkspaceMenu";

/** 欢迎页品牌组（App 空白 hero 与 SessionView 空白会话共用一处定义，改文案
 *  不会只落到一边）：「我们在 {项目名} 做点什么？」——项目名跟随当前工作
 *  空间自动替换；空间未解析（引擎无 workspace 面或首拉未回）时退回
 *  「做点什么？」。项目名可点击（点状虚线）弹出项目切换菜单，右键出项目文件夹菜单。 */
export function HeroBrand() {
  const store = useStore();
  const { t, tt } = useT();
  const ws = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId);
  const [pickOpen, setPickOpen] = useState(false);
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const wsBtnRef = useRef<HTMLButtonElement | null>(null);
  return (
    <div className="hero-brand">
      <div className="hero-title">
        {ws ? (
          <>
            {tt("我们在 ", "What should we do in ")}
            <span className="hero-ws-wrap">
              <button
                ref={wsBtnRef}
                className="hero-ws"
                onClick={() => setPickOpen(true)}
                onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY }); }}
              >
                {ws.title}
              </button>
              {pickOpen && <ProjectMenu onClose={() => setPickOpen(false)} anchorRef={wsBtnRef} />}
              {ctx && <WorkspaceMenu ws={ws} x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} />}
            </span>
            {tt(" 做点什么？", "?")}
          </>
        ) : t("做点什么？")}
      </div>
    </div>
  );
}
