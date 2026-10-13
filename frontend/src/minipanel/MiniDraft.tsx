// 迷你面板的首页（#/mini 草稿脸）：对话卡同族的紧凑会话面，内容直接坐在原生玻璃上
// ——头部（新会话 + 模型行）之下左上问候 + 提示词胶囊（点一颗把整段提示词预填进输入框，
// 与壳命令 runQuickCommand 走同一条预填通道 dd:composer-prefill），输入框钉底。模型
// apparatus 与主窗草稿页共用（useDraftModelFace）。
// 胶囊清单是纯前端常量（miniHomePrompts.ts）：首页给的是"帮你写好第一句"的提示词，
// **不放 / 命令列表**——命令目录的消费面是壳侧药丸的命令卡（store.quickCommands 推壳）。
// 设置不在本页：右上控件簇那颗齿轮（与历史/新建同排）开的是命令中心，标题点击同一落点
// （onOpenSettings）。

import { useDraftModelFace } from "../useDraftModelFace";
import { useT } from "../i18n";
import { DD_EVENTS, dispatchAppEvent } from "../events";
import { SessionHeader } from "../session/SessionHeader";
import { Composer } from "../components/Composer";
import { MINI_HOME_PROMPTS } from "./miniHomePrompts";

export function MiniDraft({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t, tt } = useT();
  const { face, effort } = useDraftModelFace();
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
    </div>
  );
}
