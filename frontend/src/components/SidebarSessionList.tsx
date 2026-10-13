// 侧栏的会话列表：当前空间的项目行（折叠/⋯ 菜单/新建）+ 分组 + 行渲染 +
// 末行「新会话」入口。菜单落点在 SidebarContextMenus，调宽热区在 SidebarResizer。
// 只管渲染，不管手势与菜单开关：那些由 Sidebar 决定后当 props 传进来。
import { useMemo } from "react";
import { Archive, ChevronDown, Ellipsis, MessageCirclePlus, Pin, Plus } from "lucide-react";
import { useT } from "../i18n";
import { useStore } from "../store";
import { comboFor } from "../keybinds";
import { Spinner } from "./LoadingState";
import { HoverScrollText } from "./HoverScrollText";
import { wsGlyphIcon } from "./IconPicker";
import { useWsIcon } from "../wsIcons";
import { longPressHandlers } from "../longPress";
import { fadeAttrs, useEdgeFade } from "../useEdgeFade";
import { useSelectionGlide } from "./useSelectionGlide";
import { bucketLabel, fmtTime } from "../session/sessionTime";
import { sessionTitle } from "../session/sessionTitle";
import { alertDialog, confirmDialog } from "./DialogHost";
import { setReadingBar } from "../session/readingProgress";
import type { SessionSummary } from "../types";

/** 一组会话：label 为分组标题（"" = 不出标题行）。 */
interface SessionGroup {
  label: string;
  items: SessionSummary[];
}

export function SidebarSessionList({
  collapsed,
  onToggleCollapsed,
  onOpenRowMenu,
  onOpenWorkspaceMenu,
  onNewSession,
  onQuickSession,
  slideDir,
}: {
  /** 程序化切换（点切换器/菜单）的滑入方向：fwd=自右 / back=自左。
   *  程序化切换（点空间格 / ⌥数字）后的入场方向。 */
  slideDir?: "fwd" | "back";
  /** 项目行折叠态：两片共用（折叠是当前空间的观感，横滑中不该各折各的）。 */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenRowMenu: (s: SessionSummary, x: number, y: number) => void;
  onOpenWorkspaceMenu: (x: number, y: number) => void;
  onNewSession: () => void;
  /** 快捷会话（D14）：开**会话面板窗**（快捷空间的窗口）。 */
  onQuickSession: () => void;
}) {
  const store = useStore();
  const { t, tt, lang } = useT();
  const activeWs = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId);
  const hasWs = store.workspaces.length > 0;
  // 会话 → 空间归属：不在任何空间的会话按惯例归第一个空间；引擎没有工作
  // 空间面时（hasWs=false）全部会话视为"当前空间"，退回单列表行为。
  const wsOf = (s: SessionSummary): string | undefined =>
    hasWs ? (store.wsOfSession.get(s.sessionId) ?? store.workspaces[0].workspaceId) : undefined;

  // 某空间的时间分组。抽成按 wsId 取的函数：横滑时相邻空间也要出一份内容。
  // blank 会话不滤——新建的会话要以 "New Chat" 出现在侧栏顶部（§2.2）。置顶会话
  // 独立成组浮在分组之前。subagent 派生会话不进会话栏（引擎自动创建的工作单元，
  // 入口在状态胶囊/父会话）。
  const groupsOf = useMemo(() => {
    return (wsId: string | undefined): SessionGroup[] => {
      const list = store.sidebarSessions.filter((s) => !hasWs || wsOf(s) === wsId);
      const pinnedList = list.filter((s) => store.pinned.has(s.sessionId));
      const rest = list.filter((s) => !store.pinned.has(s.sessionId));
      const byBucket = new Map<string, SessionSummary[]>();
      for (const s of rest) {
        const key = bucketLabel(s.updatedAt, lang);
        if (!byBucket.has(key)) byBucket.set(key, []);
        byBucket.get(key)!.push(s);
      }
      const out: SessionGroup[] = [];
      if (pinnedList.length > 0) out.push({ label: t("置顶"), items: pinnedList });
      return [...out, ...[...byBucket.entries()].map(([label, items]) => ({ label, items }))];
    };
    // wsOf 是每渲染函数包装（仅读 wsOfSession，已入表）——入表即每渲染重算，显式排除
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.sidebarSessions, store.workspaces, store.wsOfSession, store.pinned, lang, hasWs, t]);

  const view = groupsOf(activeWs?.workspaceId);
  // 会话列表溢出渐隐（超限标准 UI）
  const sessionsFade = useEdgeFade("y");
  // 选中态滑移（底片 .glide-row 在 .sessions 里，跨分组移动也连续）
  const glide = useSelectionGlide<HTMLDivElement>(
    store.activeSessionId ? ".task-row[data-sel]" : null, store.activeSessionId);

  // 行首槽位：运行/未读状态优先；都没有时给「置顶」钮（hover 显现，已置顶常驻）
  // ——置顶的会话不受自动归档限制（设置·通用）
  const renderRow = (s: SessionSummary) => (
    <button
      key={s.sessionId}
      className={`task-row${s.sessionId === store.activeSessionId ? " selected" : ""}${s.running ? " running" : ""}${store.unread.has(s.sessionId) ? " unread" : ""}`}
      {...(s.sessionId === store.activeSessionId ? { "data-sel": "" } : {})}
      onClick={() => store.openSession(s.sessionId)}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenRowMenu(s, e.clientX, e.clientY);
      }}
      {...longPressHandlers((x, y) => onOpenRowMenu(s, x, y))}
    >
      {/* 阅读进度灰底：只有选中的那一行有（读数由会话页滚动时逐帧写在这枚 span 上，
          见 session/readingProgress.ts）。行内三段内容在 CSS 里抬它一层。 */}
      {s.sessionId === store.activeSessionId && (
        <span className="row-read" aria-hidden="true" ref={setReadingBar} />
      )}
      <span className="row-slot">
        {s.running ? (
          <Spinner />
        ) : store.unread.has(s.sessionId) ? (
          <span className="unread-dot" />
        ) : (
          <button
            type="button"
            className="row-pin-btn"
            data-pinned={store.pinned.has(s.sessionId) || undefined}
            data-tip={store.pinned.has(s.sessionId) ? t("取消置顶") : t("置顶")}
            aria-label={store.pinned.has(s.sessionId) ? t("取消置顶") : t("置顶")}
            aria-pressed={store.pinned.has(s.sessionId)}
            onClick={(e) => { e.stopPropagation(); store.togglePin(s.sessionId); }}
          >
            <Pin size={12} />
          </button>
        )}
      </span>
      <span className="row-main">
        <span className="row-title-line">
          <HoverScrollText className="title">{sessionTitle(s, lang)}</HoverScrollText>
        </span>
      </span>
      <span className="row-actions"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenRowMenu(s, e.clientX, e.clientY);
        }}
        {...longPressHandlers((x, y) => onOpenRowMenu(s, x, y))}
      >
        <span className="row-time">{fmtTime(s.updatedAt, lang)}</span>
        <button
          className="row-archive"
          data-tip={t("归档任务")}
          onClick={async () => {
            // 运行中会话归档前问一句：归档只挪列表归属，任务照跑（不拦死也不误伤）
            if (s.running) {
              const ok = await confirmDialog({
                title: t("归档任务"),
                message: t("这个会话正在运行。归档只把它移出任务列表，任务会继续跑；要停请先在会话里点停止。"),
                confirmLabel: t("归档"),
              });
              if (!ok) return;
            }
            const err = await store.archiveSession(s.sessionId);
            if (err) void alertDialog({ message: tt("归档失败：{m}", "Archive failed: {m}", { m: err }) });
          }}
        >
          <Archive size={13} />
        </button>
      </span>
    </button>
  );

  // 当前片的 .sessions 同时是渐隐测量目标与滑移底片的定位祖先；相邻片不参与
  // （底片在本容器内 querySelector，跨容器找不到选中行，自然不渲染）
  const setSessionsRef = (el: HTMLDivElement | null) => {
    sessionsFade.ref(el);
    glide.setContainer(el);
  };

  const ws = activeWs;

  return (
    <>
      {ws && (
        <div className="ws-pane" data-dir={slideDir}>
          <WorkspaceRow
            wsId={ws.workspaceId}
            title={ws.title}
            collapsed={collapsed}
            onToggle={onToggleCollapsed}
            onOpenMenu={onOpenWorkspaceMenu}
            onNewSession={onNewSession}
          />
          {/* visibility 而非 display:none：.ws-pane-list 是 flex:1 撑高元素，折叠时
              必须保留占位，否则底部设置行会滑上来顶到项目行。 */}
          <div className="ws-pane-list" style={{ visibility: collapsed ? "hidden" : undefined }}>
            <div className="sessions fade-y" ref={setSessionsRef} {...fadeAttrs(sessionsFade.fade)}>
              {glide.box && <div className="sel-glide glide-row" style={glide.glideStyle} />}
              {view.map(({ label, items }) => (
                <div key={label}>
                  {label && <div className="section-label">{label}</div>}
                  {items.map((s) => renderRow(s))}
                </div>
              ))}
              {view.length === 0 && <div className="empty-state">{t("暂无会话")}</div>}
            </div>
            {/* 「新会话」入口（Safari New tab 式）：紧跟滚动列表之后——列表短时
                贴着最后一行（.sessions 收缩为内容高），会话多到要滚时被顶到底部
                常驻（设置行上面那行）。切草稿页，首条消息才建会话。
                行内有文字，不挂 data-tip——提示只给没有文字的按钮用。 */}
            <div className="new-session-row">
              <button className="new-session-entry" onClick={onNewSession}>
                <Plus size={14} />
                <span className="ns-label">{t("新会话")}</span>
              </button>
              {/* 快捷会话（D14）：同一行行尾的第二个落点（不是另起一块），
                  所以只有图标、没有自己的底；点它开**会话面板窗**（快捷会话
                  那扇窗），悬停提示照旧挂这颗——行内没有文字。
                  数据快照键在 keybinds 不占位 */}
              <button
                className="quick-session-entry"
                onClick={onQuickSession}
                data-tip={t("快捷会话")}
              >
                <MessageCirclePlus size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** 项目行：官方 ProjectRowItem 同款交互——点行折叠/展开会话；hover 显出
 *  chevron（替代项目图标，折叠时转 -90°）与 ⋯/＋ 行尾按钮。 */
function WorkspaceRow({
  wsId,
  title,
  collapsed,
  onToggle,
  onOpenMenu,
  onNewSession,
}: {
  wsId: string;
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  onOpenMenu: (x: number, y: number) => void;
  onNewSession: () => void;
}) {
  const { t } = useT();
  const { keybinds } = useStore();
  // 行首槽位只显示"选过"的项目 glyph；没选就留空——行首摆一个首字母很怪，
  // 首字母只在切换条/命令面板/图标选择器里出现（用户定稿）。
  const Glyph = wsGlyphIcon(useWsIcon(wsId));
  return (
    <div
      className={`ws-row${collapsed ? " collapsed" : ""}${Glyph ? "" : " no-glyph"}`}
      role="treeitem"
      aria-expanded={!collapsed}
      onClick={onToggle}
    >
      {/* 图标槽只在选了 glyph 时占位：没选就没有缩进，标题首字与上方图标同列
          （用户定稿）。折叠箭头是行内绝对定位——它悬停/折叠时盖在图标槽那一位，
          所以有没有 glyph 都不参与布局、不会把标题推走。 */}
      {Glyph && (
        <span className="ws-lead" aria-hidden="true">
          <Glyph size={13} className="ws-folder-ic" />
        </span>
      )}
      <ChevronDown size={13} className="ws-chevron-ic" aria-hidden="true" />
      <span className="ws-name">{title}</span>
      <span className="ws-row-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className="ws-act"
          data-tip={t("工作空间操作")}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onOpenMenu(r.left, r.bottom + 4);
          }}
        >
          <Ellipsis size={14} />
        </button>
        {/* 同顶栏 ＋：只切到草稿页，首条消息发出才真正建会话。
            键帽走注册表（改键后跟着变），别写死「⌘N」。 */}
        <button
          className="ws-act"
          data-tip={t("新会话")}
          data-tip-keys={comboFor("new-session", keybinds)}
          onClick={onNewSession}
        >
          <Plus size={14} />
        </button>
      </span>
    </div>
  );
}
