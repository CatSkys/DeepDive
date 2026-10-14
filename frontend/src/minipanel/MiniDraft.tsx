// 迷你面板的首页（#/mini 草稿脸）：对话卡同族的紧凑会话面，内容直接坐在原生玻璃上
// ——头部（只有标题一行）之下招呼语居中，输入框钉底（空状态的两段式）。模型 apparatus
// 与主窗草稿页共用（useDraftModelFace）。
// 设置不在本页：右上控件簇那颗齿轮（与历史/新建同排）开的是命令中心，标题点击同一落点
// （onOpenSettings）。头部**只留标题**（showModel=false）：模型行不在这儿，模型在设置那张
// 命令中心里改——头部两行会把内容区压窄（用户 2026-10-13 定稿），头部高度随之由
// theme.css 里面板作用域的 --session-header-h 收窄。

import { useDraftModelFace } from "../useDraftModelFace";
import { useT } from "../i18n";
import { SessionHeader } from "../session/SessionHeader";
import { Composer } from "../components/Composer";

export function MiniDraft({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t, tt } = useT();
  const { face, effort } = useDraftModelFace();
  return (
    <div className="session-row">
      <div className="mini-draft">
        <div className="hero-top">
          <SessionHeader title={t("新会话")} face={face} showModel={false} onTitleClick={onOpenSettings} />
        </div>
        <h1 className="mini-draft-hello">{tt("有什么可以帮你的？", "How can I help you?")}</h1>
        <div className="mini-draft-foot">
          <Composer sessionId={null} effort={effort} />
        </div>
      </div>
    </div>
  );
}
