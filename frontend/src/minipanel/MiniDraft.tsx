// 迷你面板的草稿页（#/mini）：对话卡同族的紧凑会话面，内容直接坐在原生玻璃上
// ——头部（新会话 + 模型行 + 设置卡入口，与会话页同一根条）之下左上问候 + 副题
// + / 命令快捷行（命令目录前几条，点行预填输入框），输入框钉底。模型 apparatus
// 与主窗草稿页共用（useDraftModelFace）；命令目录一条腿（store.quickCommands），
// 点行与壳命令 runQuickCommand 走同一条预填通道（dd:composer-prefill）。

import { Terminal } from "lucide-react";
import { useState } from "react";
import { useDraftModelFace } from "../useDraftModelFace";
import { useStore } from "../store";
import { useT } from "../i18n";
import { DD_EVENTS, dispatchAppEvent } from "../events";
import { HeroPanel, HeroPanelTrigger } from "../sidebar-right/HeroPanel";
import { HeroBrand } from "../components/HeroBrand";
import { SessionHeader } from "../session/SessionHeader";
import { Composer } from "../components/Composer";

/** 草稿页列出的命令行数：Atd 主面板同位就是三五行，4 条正好一屏。 */
const QUICK_ROWS = 4;

export function MiniDraft() {
  const store = useStore();
  const { t, tt } = useT();
  const { face, effort, reloadModels } = useDraftModelFace();
  const [panelOpen, setPanelOpen] = useState(false);
  const rows = store.quickCommands.filter((c) => c.description).slice(0, QUICK_ROWS);
  const prefill = (name: string) => dispatchAppEvent(DD_EVENTS.composerPrefill, { text: `/${name}` });
  return (
    <div className="session-row">
      <div className="mini-draft">
        {/* 右上角会话设置卡入口：主窗草稿页 HeroPanelTrigger 的同款同位。 */}
        <HeroPanelTrigger open={panelOpen} onToggle={() => setPanelOpen((v) => !v)} />
        <div className="hero-top">
          <SessionHeader title={t("新会话")} face={face} onTitleClick={() => setPanelOpen(true)} />
        </div>
        <div className="mini-draft-greet">
          <HeroBrand />
          <p className="mini-draft-sub">{tt("直接提问，或用 / 命令开始。", "Ask directly, or start with a / command.")}</p>
        </div>
        {rows.length > 0 && (
          <div className="mini-draft-commands">
            {rows.map((c) => (
              <button type="button" key={c.name} className="mini-cmd-row" onClick={() => prefill(c.name)}>
                <Terminal size={15} className="mini-cmd-glyph" aria-hidden="true" />
                <span className="mini-cmd-text">
                  <span className="mini-cmd-name">{c.name}</span>
                  <span className="mini-cmd-desc">{c.description}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="mini-draft-foot">
          <Composer sessionId={null} effort={effort} />
        </div>
      </div>
      <HeroPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        reloadModels={reloadModels}
        face={face}
      />
    </div>
  );
}
