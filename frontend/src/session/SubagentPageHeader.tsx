// 子会话页头（origin==='subagent' 的会话视图）：按用户定稿，子智能体的会话
// **是只读预览**——不挂输入框（原来 continuable 子会话能续话的那条路随之撤掉），
// 形态照全屏产物预览的页头：返回父会话 + 标题，内容铺满整页。
import { ChevronLeft } from "lucide-react";
import { t } from "../i18n";
import { useStore } from "../store";

export function SubagentPageHeader({ title, parentSessionId }: { title: string; parentSessionId?: string }) {
  const { openSession } = useStore();
  return (
    <div className="session-header preview-page-head">
      <div className="left">
        <div className="title-row">
          {parentSessionId && (
            <button
              type="button"
              className="session-back"
              data-tip={t("返回父会话")}
              aria-label={t("返回父会话")}
              onClick={() => openSession(parentSessionId)}
            >
              <ChevronLeft size={15} />
            </button>
          )}
          <div className="title">{title}</div>
        </div>
      </div>
    </div>
  );
}
