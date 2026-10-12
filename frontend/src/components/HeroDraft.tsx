// 草稿页（hero，主窗）：新会话未落库前的居中版——品牌问候 + 输入区，模型与档位
// 选择走 useDraftModelFace（与迷你面板草稿页共用一份），会话设置卡挂右上。

import { useState } from "react";
import { useDraftModelFace } from "../useDraftModelFace";
import { HeroPanel, HeroPanelTrigger } from "../sidebar-right/HeroPanel";
import { HeroBrand } from "./HeroBrand";
import { Composer } from "./Composer";
import { SessionHeader } from "../session/SessionHeader";
import { useT } from "../i18n";

export function HeroDraft() {
  const { t } = useT();
  const { face, effort, reloadModels } = useDraftModelFace();
  const [heroPanelOpen, setHeroPanelOpen] = useState(false);
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
          <SessionHeader title={t("新会话")} face={face} onTitleClick={() => setHeroPanelOpen(true)} />
        </div>
        <HeroBrand />
        <div className="hero-composer">
          <Composer sessionId={null} effort={effort} />
        </div>
      </div>
      <HeroPanel
        open={heroPanelOpen}
        onClose={() => setHeroPanelOpen(false)}
        reloadModels={reloadModels}
        face={face}
      />
    </div>
  );
}
