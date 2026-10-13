// 迷你面板右上角的控件簇（面板自有，不借主窗的头部座位）：新建会话 + 会话历史开关 +
// 会话设置入口。三颗钮聚成一个悬浮胶囊（macOS 悬浮工具组的样子：整组共享一个胶囊底、
// 项 hover/选中出内层高亮），簇绝对定在窗右上 8/16（见 theme.css 的 .app.mini-panel 块）。
// 只管这三颗钮的渲染与选中态——「设置」开的是哪张卡由调用方按当前脸给（草稿脸开草稿的
// 设置卡，会话脸开会话设置卡），「新建」落哪里也由调用方给（面板里 = 快捷空间新草稿）。
import { History, Plus, Settings2 } from "lucide-react";
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
  return (
    <div className="mini-controls">
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
        aria-label={t("会话设置")}
        data-tip={t("会话设置")}
        onClick={onOpenSettings}
      >
        <Settings2 size={17} />
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
