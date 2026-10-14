import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RefObject } from "react";
import { Check, Folder, Plus, Search } from "lucide-react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { openNewProjectDialog } from "./NewProjectDialog";
import { placeFloating } from "./floatingPlacement";
import type { FloatingPlacement } from "./floatingPlacement";
import { GlassLayer } from "./GlassLayer";

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
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<FloatingPlacement | null>(null);

  // 量触发器必须在绘制前完成，否则首帧会闪在左上角（ModelMenu 同款）
  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (el) setRect(placeFloating(el.getBoundingClientRect(), { width: MENU_WIDTH, height: MENU_MAX_HEIGHT }));
  }, [anchorRef]);

  // click-outside 关闭：portal 挂 body，触发器也算"内部"——点触发器由父级的
  // 开合逻辑接管（否则 mousedown 先关、click 再开，看着像"点不动"），ModelMenu 同款
  useEffect(() => {
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !anchorRef.current?.contains(target)) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose, anchorRef]);

  // 搜索过滤：标题或路径命中
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return store.workspaces;
    return store.workspaces.filter((w) => w.title.toLowerCase().includes(q) || w.path.toLowerCase().includes(q));
  }, [store.workspaces, query]);

  if (rect === null) return null;
  return createPortal(
    <div className="ws-menu" ref={ref} data-strip-interactive
      style={{ position: "fixed", top: rect.top, left: rect.left, maxHeight: rect.maxHeight }}>
         <GlassLayer />
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
    </div>,
    document.body,
  );
}
