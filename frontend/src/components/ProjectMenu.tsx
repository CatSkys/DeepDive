import { useMemo, useState } from "react";
import type { RefObject } from "react";
import { Check, Folder, Plus, Search } from "lucide-react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { openNewProjectDialog } from "./NewProjectDialog";
import { Popover } from "./Popover";
// 项目切换菜单（搜索 + 项目列表（文件夹图标 + 名称，当前项目右侧打勾）+ 底部
// 「新建项目」）：hero 品牌组的项目名与会话头的项目胶囊（侧栏收起态）两处入口
// 共用。弹层挂 body（portal + fixed，按触发器实测定位）——先前是纯 CSS 绝对定位
// 挂在标题下，会话头从项目胶囊打开时菜单仍锚在标题文字上，位置对不上（2026-10-12
// 用户报障）。不做参考图里的「不在项目中工作」——本客户端每个会话必属一个工作
// 空间，引擎无此语义。
/** 与 .ws-menu 的 width/max-height 同步（定位按它们算翻转与限高）。 */
const MENU_WIDTH = 280;
const MENU_MAX_HEIGHT = 420;

export function ProjectMenu({ onClose, anchorRef }: { onClose: () => void; anchorRef: RefObject<HTMLElement | null> }) {
  const store = useStore();
  const { t } = useT();
  const [query, setQuery] = useState("");

  // 搜索过滤：标题或路径命中
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return store.workspaces;
    return store.workspaces.filter((w) => w.title.toLowerCase().includes(q) || w.path.toLowerCase().includes(q));
  }, [store.workspaces, query]);

  return (
    <Popover
      open
      anchor={anchorRef}
      onClose={onClose}
      sideOffset={4}
      width={MENU_WIDTH}
      maxHeight={MENU_MAX_HEIGHT}
      className="ws-menu"
      data-strip-interactive=""
      style={{ maxHeight: MENU_MAX_HEIGHT }}
    >
      <div className="ws-menu-search">
        <Search size={13} />
        <input autoFocus placeholder={t("搜索项目")} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="ws-menu-body">
        {list.map((w) => {
          const active = w.workspaceId === store.activeWorkspaceId;
          return (
            <button
              key={w.workspaceId}
              className="ws-menu-row"
              data-tip={w.path}
              onClick={() => {
                store.switchWorkspace(w.workspaceId, { keepDraft: true });
                onClose();
              }}
            >
              <Folder size={15} />
              <span className="name">{w.title}</span>
              {active && <Check size={15} className="check" />}
            </button>
          );
        })}
        {list.length === 0 && <div className="ws-menu-empty">{t("没有匹配的项目")}</div>}
      </div>
      <div className="ws-menu-sep" />
      <div className="ws-menu-foot">
        <button
          className="ws-menu-row"
          onClick={() => {
            // 先关菜单再开弹窗：弹窗挂在 App 根部（NewProjectDialogHost），
            // 不随菜单卸载
            onClose();
            openNewProjectDialog();
          }}
        >
          <Plus size={15} />
          <span className="name">{t("新建项目")}</span>
        </button>
      </div>
    </Popover>
  );
}
