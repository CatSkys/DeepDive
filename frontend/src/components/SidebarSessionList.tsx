// 侧栏的工作区横滑内容条：并排渲染"当前空间 + 拖动方向上的相邻空间"两片，
// 整条一起平移（.ws-strip / .ws-pane，见 theme.css 与 useWorkspaceSwipe）。
// 每片内部＝项目行 + 该空间的会话列表；分组规则（置顶/时间桶/搜索合并）也在这，
// 因为相邻片要出自己的一份内容——横滑要无缝，就不能只让当前空间有列表。
// 不管手势与菜单开关：那些由 Sidebar 决定后当 props 传进来。
import { useMemo } from "react";
import { Archive, ChevronDown, Ellipsis, Pin, Plus } from "lucide-react";
import { useT } from "../i18n";
import { useStore } from "../store";
import { InlineLoader } from "./LoadingState";
import { HoverScrollText } from "./HoverScrollText";
import { wsGlyphIcon } from "./IconPicker";
import { useWsIcon } from "../wsIcons";
import { longPressHandlers } from "../longPress";
import { fadeAttrs, useEdgeFade } from "../useEdgeFade";
import { bucketLabel, fmtTime } from "../session/sessionTime";
import { sessionTitle } from "../session/sessionTitle";
import { searchGroups, type SessionGroup } from "../session/searchGroups";
import { alertDialog, confirmDialog } from "./DialogHost";
import type { SessionSummary } from "../types";

export function SidebarSessionList({
  query,
  contentHits,
  hitsTruncated,
  neighborId,
  collapsed,
  onToggleCollapsed,
  onOpenRowMenu,
  onOpenWorkspaceMenu,
  onNewSession,
  slideDir,
}: {
  /** 原始搜索串（未 trim）：空串＝不在搜索。 */
  query: string;
  /** 全文命中片段（sessionId → snippet）：标题命中之外的补充，去重合并。 */
  contentHits: Map<string, string>;
  /** 引擎把全文结果截断了（session/search 上限 20 条）——得说一声。 */
  hitsTruncated: boolean;
  /** 拖动方向上的相邻空间：并排渲染才无缝。搜索态传 undefined（不挂相邻片）。 */
  neighborId?: string;
  /** 程序化切换（点切换器/菜单）的滑入方向：fwd=自右 / back=自左。
   *  只给当前片——相邻片是手势拖出来的，不该再叠一段入场动画。 */
  slideDir?: "fwd" | "back";
  /** 项目行折叠态：两片共用（折叠是当前空间的观感，横滑中不该各折各的）。 */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenRowMenu: (s: SessionSummary, x: number, y: number) => void;
  onOpenWorkspaceMenu: (x: number, y: number) => void;
  onNewSession: () => void;
}) {
  const store = useStore();
  const { t, tt, lang } = useT();
  const searching = query.trim().length > 0;
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
    if (searching) return () => [];
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
  }, [searching, store.sidebarSessions, store.workspaces, store.wsOfSession, store.pinned, lang, hasWs, t]);

  // 搜索视图：全空间结果，按来源项目分组（整形见 session/searchGroups）。
  const searchView = useMemo<SessionGroup[]>(() => searchGroups({
    query,
    lang,
    sessions: store.allSessions,
    removed: store.removed,
    workspaces: store.workspaces,
    wsOfSession: store.wsOfSession,
    contentHits,
  }), [query, store.allSessions, store.removed, store.workspaces, store.wsOfSession, contentHits, lang]);

  // 判定"是否在搜索"必须用 trim 后的值：搜索框残留一个空格时原始 query 为真值、
  // 而 trim 后的空串会命中全部会话 —— 曾把跨空间搜索视图退化成"所有工作空间的内容
  // 混铺一屏"（用户报告的混屏根因）。
  const view = searching ? searchView : groupsOf(activeWs?.workspaceId);
  // 会话列表溢出渐隐（超限标准 UI）
  const sessionsFade = useEdgeFade();

  // 行首槽位：运行/未读状态优先；都没有时给「置顶」钮（hover 显现，已置顶常驻）
  // ——置顶的会话不受自动归档限制（设置·通用）
  const renderRow = (s: SessionSummary, snippet?: string, archived = false) => (
    <button
      key={s.sessionId}
      className={`task-row${s.sessionId === store.activeSessionId ? " selected" : ""}${s.running ? " running" : ""}${store.unread.has(s.sessionId) ? " unread" : ""}`}
      onClick={() => store.openSession(s.sessionId)}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenRowMenu(s, e.clientX, e.clientY);
      }}
      {...longPressHandlers((x, y) => onOpenRowMenu(s, x, y))}
    >
      <span className="row-slot">
        {s.running ? (
          <InlineLoader />
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
        {/* 后台运行会话已被 store 过滤，不会走到这里；剩下的标识只有「已归档」 */}
        <span className="row-title-line">
          {archived && <span className="row-auto-badge">{t("已归档")}</span>}
          <HoverScrollText className="title">{sessionTitle(s, lang)}</HoverScrollText>
        </span>
        {snippet && <span className="row-snippet">{snippet}</span>}
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

  const neighborWs = neighborId ? store.workspaces.find((w) => w.workspaceId === neighborId) : undefined;
  const panes = [activeWs, neighborWs].filter((w): w is NonNullable<typeof w> => Boolean(w));

  return (
    <>
      {panes.map((ws) => {
        const isNeighbor = ws.workspaceId !== activeWs?.workspaceId;
        // 当前片走 view（搜索态是跨空间结果），相邻片走自己的分组——滑过去看到的是
        // 隔壁那一片的真内容，这是无缝的关键。
        const paneGroups = isNeighbor ? groupsOf(ws.workspaceId) : view;
        return (
          <div
            className="ws-pane"
            key={ws.workspaceId}
            data-neighbor={isNeighbor ? "" : undefined}
            data-dir={isNeighbor ? undefined : slideDir}
          >
            <WorkspaceRow
              wsId={ws.workspaceId}
              title={ws.title}
              collapsed={collapsed}
              onToggle={onToggleCollapsed}
              onOpenMenu={onOpenWorkspaceMenu}
              onNewSession={onNewSession}
            />
            {/* visibility 而非 display:none：.ws-pane-list 是 flex:1 撑高元素，折叠时
                必须保留占位，否则底部设置行会滑上来顶到项目行。搜索时永不折叠。 */}
            <div className="ws-pane-list" style={{ visibility: !searching && collapsed ? "hidden" : undefined }}>
              <div className="sessions fade-y" ref={sessionsFade.ref} {...fadeAttrs(sessionsFade.fade)}>
                {paneGroups.map(({ label, items }) => (
                  <div key={label}>
                    {label && <div className="section-label">{label}</div>}
                    {items.map((s) => renderRow(
                      s,
                      searching ? contentHits.get(s.sessionId) : undefined,
                      searching ? store.archived.has(s.sessionId) : false,
                    ))}
                  </div>
                ))}
                {/* 空态与搜索提示只出在当前片：相邻片空着是滑动途中的正常态 */}
                {!isNeighbor && view.length === 0 && (
                  <div className="empty-state">{query ? t("无结果") : t("暂无会话")}</div>
                )}
                {!isNeighbor && query.trim().length === 1 && (
                  <div className="search-hint">{t("只按标题匹配；输入 2 个字以上可搜全文内容")}</div>
                )}
                {!isNeighbor && hitsTruncated && (
                  <div className="search-hint">{t("全文结果较多，只显示前 20 条——再输入几个字缩小范围")}</div>
                )}
              </div>
            </div>
          </div>
        );
      })}
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
        {/* 同顶栏 ＋：只切到草稿页，首条消息发出才真正建会话 */}
        <button className="ws-act" data-tip={t("新会话")} onClick={onNewSession}>
          <Plus size={14} />
        </button>
      </span>
    </div>
  );
}
