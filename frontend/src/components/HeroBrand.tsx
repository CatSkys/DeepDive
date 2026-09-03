import { useStore } from "../store";
import { useT } from "../i18n";

/** 欢迎页品牌组（App 空白 hero 与 SessionView 空白会话共用一处定义，改文案
 *  不会只落到一边）：「我们在 {项目名} 做点什么？」——项目名跟随当前工作
 *  空间自动替换；空间未解析（引擎无 workspace 面或首拉未回）时退回
 *  「做点什么？」。 */
export function HeroBrand() {
  const store = useStore();
  const { t, tt } = useT();
  const ws = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId);
  return (
    <div className="hero-brand">
      <div className="hero-title">
        {ws
          ? tt(`我们在 ${ws.title} 做点什么？`, `What should we do in ${ws.title}?`)
          : t("做点什么？")}
      </div>
    </div>
  );
}
