// 迷你面板右上角的控件簇（面板自有，不借主窗的头部座位）：会话历史开关 + 会话设置入口。
// 只管这两个钮的渲染与选中态——「设置」开的是哪张卡由调用方按当前脸给（草稿脸开草稿的
// 设置卡，会话脸开会话设置卡）。钮的观感与主窗那颗座位同款（.panel-expand-btn），簇本身
// 绝对定在窗右上 8/16（见 theme.css 的 .app.mini-panel 块）。
import { History, Settings2 } from "lucide-react";
import { useT } from "../i18n";

export function MiniPanelControls({
  historyOpen,
  onToggleHistory,
  onOpenSettings,
}: {
  historyOpen: boolean;
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
        <History size={15} />
      </button>
      <button
        type="button"
        className="panel-expand-btn"
        aria-label={t("会话设置")}
        data-tip={t("会话设置")}
        onClick={onOpenSettings}
      >
        <Settings2 size={15} />
      </button>
    </div>
  );
}
