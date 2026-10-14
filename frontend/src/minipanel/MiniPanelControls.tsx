// 迷你面板右上角的控件簇（面板自有，不借主窗的头部座位）：新建会话 + 会话历史开关 +
// 命令中心入口。三颗钮聚成一个悬浮胶囊（macOS 悬浮工具组的样子：整组共享一个胶囊底、
// 项 hover/选中出内层高亮），簇绝对定在窗右上 8/16（见 theme.css 的 .app.mini-panel 块）。
// 只管这三颗钮的渲染与选中态——「命令中心」开的是哪张卡由调用方按当前脸给（草稿脸开草稿的
// 那张，会话脸开会话那张），「新建」落哪里也由调用方给（面板里 = 快捷空间新草稿）。
// 入口名与图标是「命令中心」（用户 2026-10-14 定稿：那张卡里除了设置还有动作行，叫"会话设置"
// 已经不准了；图标用 ⌘ 那个 Command 字形——"命令中心"的字面）。
import { useState } from "react";
import { GlassLayer } from "../components/GlassLayer";
import { Command, History, Plus } from "lucide-react";
import { useT } from "../i18n";

export function MiniPanelControls({
  historyOpen,
  onNewSession,
  onToggleHistory,
  onOpenSettings,
}: {
  historyOpen: boolean;
  onNewSession: () => void;
  onToggleHistory: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useT();
  // 整组回弹：任一钮按下时给容器挂 data-pulse（动画跑完摘掉，才能再次触发）。
  // 只做"组的响应"，单颗钮自己的按下反馈在 CSS 里（.panel-expand-btn:active）。
  const [pulse, setPulse] = useState(false);
  return (
    <div
      className="mini-controls"
      data-pulse={pulse || undefined}
      onPointerDown={() => setPulse(true)}
      onAnimationEnd={(e) => {
        if (e.animationName === "mini-controls-pulse") setPulse(false);
      }}
    >
      {/* 材质层：与输入胶囊同一条规则（[data-liquid-glass-backdrop] 是全局面），
          所以这组只留几何、材质（含系统液态玻璃档）自动接上 */}
      <GlassLayer />
      <button
        type="button"
        className="panel-expand-btn"
        aria-pressed={historyOpen}
        aria-label={t("会话历史")}
        data-tip={t("会话历史")}
        onClick={onToggleHistory}
      >
        <History size={17} />
      </button>
      <button
        type="button"
        className="panel-expand-btn"
        aria-label={t("命令中心")}
        data-tip={t("命令中心")}
        onClick={onOpenSettings}
      >
        <Command size={17} />
      </button>
      {/* 新建会话放最右：与参考图里那颗「＋」同位的主动作 */}
      <button
        type="button"
        className="panel-expand-btn"
        aria-label={t("新建会话")}
        data-tip={t("新建会话")}
        onClick={onNewSession}
      >
        <Plus size={17} />
      </button>
    </div>
  );
}
