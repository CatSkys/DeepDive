// 迷你面板的首页（#/mini 草稿脸）：对话卡同族的紧凑会话面，内容直接坐在原生玻璃上
// ——头部（新会话 + 模型行）之下左上问候 + 提示词胶囊（点一颗把整段提示词预填进输入框，
// 与壳命令 runQuickCommand 走同一条预填通道 dd:composer-prefill），输入框钉底。模型
// apparatus 与主窗草稿页共用（useDraftModelFace）。
// 胶囊清单是纯前端常量（miniHomePrompts.ts）：首页给的是"帮你写好第一句"的提示词，
// **不放 / 命令列表**——命令目录的消费面是壳侧药丸的命令卡（store.quickCommands 推壳）。
// 会话设置卡的开合由面板（MiniPanelApp）持有——入口在面板右上控件簇里，与历史钮同排；
// 本页只负责渲染那张卡与让标题点击也能开它。

import { useDraftModelFace } from "../useDraftModelFace";
import { useT } from "../i18n";
import { DD_EVENTS, dispatchAppEvent } from "../events";
import { HeroPanel } from "../sidebar-right/HeroPanel";
import { SessionHeader } from "../session/SessionHeader";
import { Composer } from "../components/Composer";
import { MINI_HOME_PROMPTS } from "./miniHomePrompts";

export function MiniDraft({
  settingsOpen,
  onOpenSettings,
  onCloseSettings,
}: {
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
}) {
  const { t, tt } = useT();
  const { face, effort, reloadModels } = useDraftModelFace();
  const prefill = (text: string) => dispatchAppEvent(DD_EVENTS.composerPrefill, { text });
  return (
    <div className="session-row">
      <div className="mini-draft">
        <div className="hero-top">
          <SessionHeader title={t("新会话")} face={face} onTitleClick={onOpenSettings} />
        </div>
        <div className="mini-draft-greet">
          <h1 className="mini-draft-hello">{tt("有什么可以帮你的？", "How can I help you?")}</h1>
          <div className="mini-draft-prompts">
            {MINI_HOME_PROMPTS.map((p) => (
              <button
                type="button"
                key={p.label}
                className="mini-prompt"
                onClick={() => prefill(tt(p.text, p.textEn))}
              >
                {tt(p.label, p.labelEn)}
              </button>
            ))}
          </div>
        </div>
        <div className="mini-draft-foot">
          <Composer sessionId={null} effort={effort} />
        </div>
      </div>
      <HeroPanel
        open={settingsOpen}
        onClose={onCloseSettings}
        reloadModels={reloadModels}
        face={face}
      />
    </div>
  );
}
