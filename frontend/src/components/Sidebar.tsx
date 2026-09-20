import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ChevronDown, CirclePlus, Ellipsis, Folder, Pin, Plus, Search, Settings } from "lucide-react";
import { IconProjectAddOutline16 } from "./Icons";
import { InlineLoader } from "./LoadingState";
import { alertDialog, confirmDialog, promptDialog } from "./DialogHost";
import { api } from "../api";
import { sendToShell } from "../host";
import { useStore } from "../store";
import { comboFor, isOff } from "../keybinds";
import { useT } from "../i18n";
import { HoverScrollText } from "./HoverScrollText";
import { openNewProjectDialog } from "./NewProjectDialog";
import { wsGlyphIcon } from "./IconPicker";
import { useWsIcon } from "../wsIcons";
import { longPressHandlers } from "../longPress";
import { WorkspaceMenuItems } from "./WorkspaceMenu";
import { WsSwitcher } from "./WsSwitcher";
import { fadeAttrs, useEdgeFade } from "../useEdgeFade";
import type { SessionSummary } from "../types";
import { sessionTitle } from "../session/sessionTitle";
import { isBadgedSession, isSidebarSession, titleHidesSession } from "../session/backgroundSession";
import { DD_EVENTS } from "../events";

interface CtxMenu { sessionId: string; title: string; cwd?: string; x: number; y: number }

export function fmtTime(updatedAt: number, lang: "zh" | "en"): string {
  const diff = Date.now() - updatedAt;
  const m = Math.floor(diff / 60000);
  if (m < 1) return lang === "zh" ? "刚刚" : "now";
  if (m < 60) return `${m}${lang === "zh" ? " 分" : "m"}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}${lang === "zh" ? " 小时" : "h"}`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}${lang === "zh" ? " 天" : "d"}`;
  return `${Math.floor(d / 7)}${lang === "zh" ? " 周" : "w"}`;
}

export function bucketLabel(updatedAt: number, lang: "zh" | "en"): string {
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const diff = now - updatedAt;
  if (diff < day) {
    const d = new Date(updatedAt);
    const t = new Date(now);
    return d.getDate() === t.getDate() ? (lang === "zh" ? "今天" : "Today") : (lang === "zh" ? "昨天" : "Yesterday");
  }
  if (diff < 7 * day) return lang === "zh" ? "上周" : "This week";
  const d = new Date(updatedAt);
  return `${d.getMonth() + 1}${lang === "zh" ? " 月" : ""}`;
}

/** 顶栏工作空间胶囊（收起态专用）：文件夹图标 + 项目名，样式对齐官方 UI
 *  顶栏。展开态由 CSS 隐藏——项目名那时常驻侧栏顶部。收起态点击弹出项目
 *  切换选框（onOpen 由 SessionHeader 传入）。 */
export function WorkspacePill({ onOpen }: { onOpen?: () => void }) {
  const store = useStore();
  const ws = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId);
  if (!ws) return null;
  return (
    <span className="ws-pill" role="button" onClick={onOpen}>
      <Folder size={12} />
      <span className="ws-pill-name">{ws.title}</span>
    </span>
  );
}

export function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const store = useStore();
  const [query, setQuery] = useState("");
  /** 搜索框是否展开（非常驻）。由顶部搜索钮 / ⌘F 打开，Esc 关闭。 */
  const [searchOpen, setSearchOpen] = useState(false);
  const [ctx, setCtx] = useState<CtxMenu | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // 搜索入口（顶部搜索钮 / ⌘F）：展开搜索框并聚焦；侧栏收起时先把侧栏展开
  // ——搜索框在侧栏里，侧栏不展开的话按钮点了没反应。
  // store 对象每次更新都换新引用（toggleSidebar 也在 useMemo 里内联重建），
  // 依赖它会让 window 监听随每次 store 变化重挂——改走 ref 取最新值，只挂一次。
  const storeRef = useRef(store);
  storeRef.current = store;
  useEffect(() => {
    const onFocus = () => {
      const s = storeRef.current;
      if (s.sidebarCollapsed) s.toggleSidebar();
      setSearchOpen(true);
      requestAnimationFrame(() => searchRef.current?.focus());
    };
    window.addEventListener(DD_EVENTS.focusSearch, onFocus);
    return () => window.removeEventListener(DD_EVENTS.focusSearch, onFocus);
  }, []);
  // 全文搜索（4.1）：引擎 session.search（标题∪正文）。内容命中随防抖
  // 异步到达；禁用部署（无 --patch 放行）下请求失败 → 静默降级 title-only。
  const [contentHits, setContentHits] = useState<Map<string, string>>(new Map());
  /** 全文命中被引擎截断（session/search 上限 20 条）：结果少不是没有，得说一声。 */
  const [hitsTruncated, setHitsTruncated] = useState(false);
  // 项目行：会话列表折叠（点行切换）与 ⋯ 菜单（重命名/删除工作区）。
  const [wsCollapsed, setWsCollapsed] = useState(false);
  const [wsCtx, setWsCtx] = useState<{ x: number; y: number } | null>(null);
  // 会话列表溢出渐隐（超限标准 UI）；元素随空间切换被 keyed 重造，
  // callback ref 换新即自动重挂监听
  const sessionsFade = useEdgeFade();

  useEffect(() => {
    const close = () => { setCtx(null); setWsCtx(null); };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  // 全文搜索请求：≥2 字符防抖 250ms；竞态以最新 query 为准（reqRef 门）。
  const searchReqRef = useRef(0);
  const trimmedQuery = query.trim();
  useEffect(() => {
    if (trimmedQuery.length < 2) {
      setContentHits(new Map());
      setHitsTruncated(false);
      return;
    }
    const seq = ++searchReqRef.current;
    const timer = setTimeout(() => {
      void api.search({ query: trimmedQuery }).then((r) => {
        if (searchReqRef.current !== seq) return;
        setContentHits(new Map(r.items.map((x) => [x.sessionId, x.snippet])));
        setHitsTruncated(r.hasMore === true);
      }).catch(() => {
        // 引擎未放行 session.query 索引（DSH-WIRE §1）：保持 title-only
        if (searchReqRef.current === seq) { setContentHits(new Map()); setHitsTruncated(false); }
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [trimmedQuery]);

  // 项目行 ⋯ 菜单动作（官方 ProjectRowItem 的 rename/delete 同款）。
  // 会话 → 空间归属：不在任何空间的会话按惯例归第一个空间；引擎没有工作
  // 空间面时（hasWs=false）全部会话视为"当前空间"，退回单列表行为。
  const { t, tt, lang } = useT();
  const hasWs = store.workspaces.length > 0;
  const wsOf = (s: SessionSummary): string | undefined =>
    hasWs ? (store.wsOfSession.get(s.sessionId) ?? store.workspaces[0].workspaceId) : undefined;
  const activeWs = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId);
  // 项目行行首图标位：只显示"选过"的项目 glyph；没选就留空——行首摆一个首字母很怪，
  // 首字母只在切换条/命令面板/图标选择器里出现（用户定稿：仅此一处例外）。
  const WsGlyph = wsGlyphIcon(useWsIcon(activeWs?.workspaceId));

  // 横滑方向（§2.1）：目标格子在后 → 内容自右滑入（fwd）；在前 → 自左（back）。
  const prevWs = useRef<string | null>(null);
  const slideDir = useRef<"fwd" | "back" | undefined>(undefined);
  if (store.activeWorkspaceId !== prevWs.current) {
    if (prevWs.current != null && store.activeWorkspaceId != null) {
      const idx = store.workspaces.findIndex((w) => w.workspaceId === store.activeWorkspaceId);
      const prev = store.workspaces.findIndex((w) => w.workspaceId === prevWs.current);
      slideDir.current = idx >= 0 && prev >= 0 && idx < prev ? "back" : "fwd";
    }
    prevWs.current = store.activeWorkspaceId;
  }

  // 触控板双指横滑切空间：横向分量占优时累计 deltaX，过阈值切上一个/下一个
  // （左滑=下一个，与轮播方向一致），到头不回绕；冷却防一次长滑连切。
  // 纵向滚动（|Y|≥|X|）不劫持，会话列表照常滚。无需 preventDefault——
  // 侧栏本无横向溢出，浏览器对纯横向 wheel 无默认行为。
  const swipeAcc = useRef({ acc: 0, coolUntil: 0 });
  const onSidebarWheel = (e: React.WheelEvent) => {
    if (store.workspaces.length < 2) return;
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const now = performance.now();
    const st = swipeAcc.current;
    if (now < st.coolUntil) return;
    st.acc += e.deltaX;
    if (Math.abs(st.acc) < 60) return;
    const idx = store.workspaces.findIndex((w) => w.workspaceId === store.activeWorkspaceId);
    const target = store.workspaces[idx + (st.acc > 0 ? 1 : -1)];
    st.acc = 0;
    st.coolUntil = now + 700;
    if (target) store.switchWorkspace(target.workspaceId);
  };

  // 当前空间视图：时间分组。blank 会话不滤——新建的会话要以 "New Chat"
  // 出现在侧栏顶部（§2.2）。置顶会话独立成组浮在分组之前。subagent 派生
  // 会话不进会话栏（引擎自动创建的工作单元，入口在状态胶囊/父会话）。
  const groups = useMemo<Array<{ label: string; items: SessionSummary[] }>>(() => {
    if (query.trim()) return [];
    const list = store.sidebarSessions.filter((s) => !hasWs || wsOf(s) === store.activeWorkspaceId);
    const pinnedList = list.filter((s) => store.pinned.has(s.sessionId));
    const rest = list.filter((s) => !store.pinned.has(s.sessionId));
    const byBucket = new Map<string, SessionSummary[]>();
    for (const s of rest) {
      const key = bucketLabel(s.updatedAt, lang);
      if (!byBucket.has(key)) byBucket.set(key, []);
      byBucket.get(key)!.push(s);
    }
    const out: Array<{ label: string; items: SessionSummary[] }> = [];
    if (pinnedList.length > 0) out.push({ label: t("置顶"), items: pinnedList });
    return [...out, ...[...byBucket.entries()].map(([label, items]) => ({ label, items }))];
    // wsOf 是每渲染函数包装（仅读 wsOfSession，已入表）——入表即每渲染重算，显式排除
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, store.sidebarSessions, store.workspaces, store.activeWorkspaceId, store.wsOfSession, store.pinned, lang, hasWs, t]);

  // 搜索视图：全空间结果，按来源项目分组（§2.5）；标题命中 + 全文命中
  // 去重合并（标题命中优先，内容命中带 snippet 行）；点击经 openSession
  // 自动切到所属空间。
  const searchGroups = useMemo<Array<{ label: string; items: SessionSummary[] }>>(() => {
    if (!query) return [];
    const q = query.trim().toLowerCase();
    // 搜索域＝用户列表层 + 归档（归档只是列表归属，不该搜不到；引擎本来就
    // 返回归档命中，旧实现拿过滤后的列表取交集，把它们全丢了）；本地已删的除外。
    const visible = store.allSessions.filter((s) => isSidebarSession(s) && !store.removed.has(s.sessionId));
    const hits = visible.filter((s) => sessionTitle(s, lang).toLowerCase().includes(q));
    const hitIds = new Set(hits.map((s) => s.sessionId));
    const contentOnly = visible.filter((s) => !hitIds.has(s.sessionId) && contentHits.has(s.sessionId));
    const merged = [...hits, ...contentOnly];
    if (!hasWs) return [{ label: "", items: merged }];
    const byWs = new Map<string, SessionSummary[]>();
    for (const s of merged) {
      const wid = wsOf(s)!;
      const arr = byWs.get(wid);
      if (arr) arr.push(s); else byWs.set(wid, [s]);
    }
    return store.workspaces
      .filter((w) => byWs.has(w.workspaceId))
      .map((w) => ({ label: w.title, items: byWs.get(w.workspaceId)! }));
    // wsOf 是每渲染函数包装（仅读 wsOfSession，已入表）——入表即每渲染重算，显式排除
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, store.allSessions, store.removed, store.workspaces, store.wsOfSession, contentHits, lang, hasWs]);

  // 判定"是否在搜索"必须用 trim 后的值：搜索框残留一个空格时原始 query
  // 为真值、而 trim 后的空串会命中全部会话 —— 曾把跨空间搜索视图退化成
  // "所有工作空间的内容混铺一屏"（用户报告的混屏根因）。
  const view = query.trim() ? searchGroups : groups;

  // 会话行的菜单打开点：右键与触屏长按共用同一个（longPressHandlers）。
  const openCtx = (s: SessionSummary, x: number, y: number) => {
    setCtx({ sessionId: s.sessionId, title: sessionTitle(s, lang), cwd: s.cwd, x, y });
  };

  const renderRow = (s: SessionSummary, snippet?: string, archived = false) => (
    <button
      key={s.sessionId}
      className={`task-row${s.sessionId === store.activeSessionId ? " selected" : ""}${s.running ? " running" : ""}${store.unread.has(s.sessionId) ? " unread" : ""}`}
      onClick={() => store.openSession(s.sessionId)}
      onContextMenu={(e) => {
        e.preventDefault();
        openCtx(s, e.clientX, e.clientY);
      }}
      {...longPressHandlers((x, y) => openCtx(s, x, y))}
    >
      {/* 行首槽位：运行/未读状态优先；都没有时给「置顶」钮（hover 显现，
          已置顶常驻）——置顶的会话不受自动归档限制（设置·通用） */}
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
        {/* 整理类后台会话（复盘/整理）留在列表但加自动标识——MiMo 的 [Auto] 徽章；
            执行类（落库/自动化运行）已被 store 过滤，不会走到这里。 */}
        <span className="row-title-line">
          {isBadgedSession(s) && <span className="row-auto-badge">{t("自动")}</span>}
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
          openCtx(s, e.clientX, e.clientY);
        }}
        {...longPressHandlers((x, y) => openCtx(s, x, y))}
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

  return (
    <aside className="sidebar" onWheel={onSidebarWheel}>
      {/* 搜索框非常驻：由顶部搜索钮 / ⌘F 打开（用户定稿——侧栏顶部让给会话列表，
          搜索收成一个按钮）。Esc 关闭并**清空**：否则输入框藏起来后列表还滤着，
          看着像会话丢了。 */}
      {searchOpen && (
        <div className="search-row" data-tip={t("搜索")} data-tip-keys={comboFor("command-palette", store.keybinds)} data-tip-pos="bottom">
          <Search size={14} />
          <input
            ref={searchRef}
            autoFocus
            placeholder={t("搜索")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.stopPropagation();
              setSearchOpen(false);
              setQuery("");
            }}
          />
        </div>
      )}
      {/* 侧栏首行「新会话」入口（§3.2 New Chat 式）：切草稿页，首条消息才建会话 */}
      <button
        className="new-session-entry"
        data-tip={t("新会话")}
        onClick={() => store.openSession(null)}
      >
        <CirclePlus size={14} />
        <span className="ns-label">{t("新会话")}</span>
        {!isOff("new-session", store.keybinds) && (
          <span className="ns-keys">{comboFor("new-session", store.keybinds)}</span>
        )}
      </button>
      {activeWs && (
        <div className="ws-view" key={`head-${activeWs.workspaceId}`} data-dir={slideDir.current}>
          {/* 官方 ProjectRowItem 同款交互：点行折叠/展开会话；hover 显出
              chevron（替代项目图标，折叠时转 -90°）与 ⋯/＋ 行尾按钮。
              行首槽位只显示弹窗里选的项目 glyph（wsIcons）；没选留空。 */}
          <div
            className={`ws-row${wsCollapsed ? " collapsed" : ""}${WsGlyph ? "" : " no-glyph"}`}
            role="treeitem"
            aria-expanded={!wsCollapsed}
            onClick={() => setWsCollapsed((v) => !v)}
          >
            {/* 图标槽只在选了 glyph 时占位：没选就没有缩进，标题首字与上方图标同列
                （用户定稿）。折叠箭头是行内绝对定位——它悬停/折叠时盖在图标槽那一位，
                所以有没有 glyph 都不参与布局、不会把标题推走。 */}
            {WsGlyph && (
              <span className="ws-lead" aria-hidden="true">
                <WsGlyph size={13} className="ws-folder-ic" />
              </span>
            )}
            <ChevronDown size={13} className="ws-chevron-ic" aria-hidden="true" />
            <span className="ws-name">{activeWs.title}</span>
            <span className="ws-row-actions" onClick={(e) => e.stopPropagation()}>
              <button
                className="ws-act"
                data-tip={t("工作空间操作")}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setCtx(null);
                  setWsCtx({ x: r.left, y: r.bottom + 4 });
                }}
              >
                <Ellipsis size={14} />
              </button>
              {/* 同顶栏 ＋：只切到草稿页，首条消息发出才真正建会话 */}
              <button className="ws-act" data-tip={t("新会话")} onClick={() => store.openSession(null)}>
                <Plus size={14} />
              </button>
            </span>
          </div>
        </div>
      )}
      <div
        className="ws-view grow"
        key={`list-${activeWs?.workspaceId ?? "all"}`}
        data-dir={slideDir.current}
        /* visibility 而非 display:none：这个容器是侧栏 flex 的 flex:1 撑高
           元素，折叠时必须保留占位，否则底部设置行会滑上来顶到项目行 */
        style={{ visibility: !query && wsCollapsed ? "hidden" : undefined }}
      >
        <div className="sessions fade-y" ref={sessionsFade.ref} {...fadeAttrs(sessionsFade.fade)}>
          {view.map(({ label, items }) => (
            <div key={label}>
              {label && <div className="section-label">{label}</div>}
              {items.map((s) => renderRow(s, !query.trim() ? undefined : contentHits.get(s.sessionId),
                !query.trim() ? false : store.archived.has(s.sessionId)))}
            </div>
          ))}
          {view.length === 0 && (
            <div className="empty-state">{query ? t("无结果") : t("暂无会话")}</div>
          )}
          {query.trim().length === 1 && (
            <div className="search-hint">{t("只按标题匹配；输入 2 个字以上可搜全文内容")}</div>
          )}
          {hitsTruncated && (
            <div className="search-hint">{t("全文结果较多，只显示前 20 条——再输入几个字缩小范围")}</div>
          )}
        </div>
      </div>
      <div className="sidebar-foot">
        <button
          className="settings-entry"
          data-tip={t("设置")}
          data-tip-keys="⌘,"
          aria-label={t("设置")}
          onClick={() => {
            onOpenSettings();
          }}
        >
          <Settings size={15} />
        </button>
        {hasWs && <WsSwitcher />}
        {/* ＋新建项目：打开 NewProjectDialog 表单弹窗（名称/图标/目录/指令，
            Hero 项目菜单同源；原"直接弹目录选择器"升级为表单）。 */}
        <button
          className="ws-add"
          data-tip={t("新建项目空间")}
          onClick={() => openNewProjectDialog()}
        >
          <IconProjectAddOutline16 size={15} />
        </button>
      </div>
      {wsCtx && activeWs && (
        <div className="ctx-menu" style={{ top: wsCtx.y, left: Math.min(wsCtx.x, window.innerWidth - 200) }} onClick={(e) => e.stopPropagation()}>
          {/* 与 hero 胶囊 / 空间格的右键菜单同一份（五项全量） */}
          <WorkspaceMenuItems ws={activeWs} onDone={() => setWsCtx(null)} />
        </div>
      )}
      {ctx && (
        <div className="ctx-menu" style={{ top: ctx.y, left: Math.min(ctx.x, window.innerWidth - 220) }} onClick={(e) => e.stopPropagation()}>
          <div className="ctx-item" onClick={() => {
            setCtx(null);
            void promptDialog({ title: t("重命名任务"), initialValue: ctx.title }).then(async (title) => {
              if (!title || !title.trim()) return;
              const next = title.trim();
              // 列表可见性由标题前缀派生：改成一个后台会话的名字 = 它从列表里消失
              if (titleHidesSession(next)) {
                const ok = await confirmDialog({
                  title: t("重命名任务"),
                  message: t("这个名字以后台会话前缀开头（自进化·／自动化·），改完这个会话会从列表里消失。确定吗？"),
                  confirmLabel: t("重命名"),
                });
                if (!ok) return;
              }
              try { await api.sessionRename({ sessionId: ctx.sessionId, title: next }); await store.refresh(); } catch (err) { void alertDialog({ message: tt(`重命名失败：${(err as Error).message}`, `Rename failed: ${(err as Error).message}`) }); }
            });
          }}>{t("重命名任务")}</div>
          <div className="ctx-item" onClick={async () => {
            const err = await store.archiveSession(ctx.sessionId);
            if (err) void alertDialog({ message: tt("归档失败：{m}", "Archive failed: {m}", { m: err }) });
            setCtx(null);
          }}>{t("归档任务")}</div>
          <div className="ctx-item" onClick={() => { store.markUnread(ctx.sessionId); setCtx(null); }}>{t("标记为未读")}</div>
          <div className="ctx-item" onClick={() => { store.togglePin(ctx.sessionId); setCtx(null); }}>
            {store.pinned.has(ctx.sessionId) ? t("取消置顶") : t("置顶")}
          </div>
          <div className="ctx-sep" />
          <div className="ctx-item" onClick={() => { sendToShell({ type: "reveal-path", path: ctx.cwd ?? "" }); setCtx(null); }}>{t("在 Finder 中打开")}</div>
          <div className="ctx-item" onClick={() => { if (ctx.cwd) navigator.clipboard.writeText(ctx.cwd); setCtx(null); }}>{t("复制路径")}</div>
          <div className="ctx-item" onClick={() => { sendToShell({ type: "copy-log-path" }); setCtx(null); }}>{t("复制日志路径")}</div>
          <div className="ctx-item" onClick={() => { navigator.clipboard.writeText(ctx.sessionId); setCtx(null); }}>{t("复制会话 ID")}</div>
          <div className="ctx-item" onClick={() => { setCtx(null); onOpenSettings(); }}>{t("前往配置")}</div>
        </div>
      )}
      <SidebarResizer />
    </aside>
  );
}

/** 侧栏右缘拖拽调宽热区：完全不可见（无分隔线），仅 col-resize 光标。
 *  拖拽中直写 CSS 变量（绕过 React 重渲染，长会话列表下不掉帧），
 *  落点才回写 store（状态 + 壳 prefs 持久化，跨重启保留）。
 *  move/up 挂 window：不依赖 setPointerCapture（未受信/合成事件下
 *  capture 可能被 WebKit 忽略），任何输入路径下拖出元素仍持续跟踪。
 *  data-strip-interactive：进 titlebar.ts 顶条 rect 表，热区上段
 *  （52px 拖窗条带内）依旧可拖调宽而非拖动窗口。双击回默认宽 240。 */
function SidebarResizer() {
  const store = useStore();
  const { t } = useT();
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const startX = e.clientX;
    const startW = store.sidebarWidth;
    const widthAt = (x: number) => Math.min(320, Math.max(200, startW + (x - startX)));
    const onMove = (ev: PointerEvent) => {
      document.documentElement.style.setProperty("--dsh-sidebar-w", `${widthAt(ev.clientX)}px`);
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (commit) store.setSidebarWidth(widthAt(lastX));
      else document.documentElement.style.setProperty("--dsh-sidebar-w", `${store.sidebarWidth}px`);
    };
    let lastX = startX;
    const onUp = (ev: PointerEvent) => { lastX = ev.clientX; finish(true); };
    const onCancel = () => finish(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    e.preventDefault();
  };
  return (
    <div
      className="sidebar-resizer"
      data-strip-interactive=""
      role="separator"
      aria-orientation="vertical"
      aria-label={t("调整侧栏宽度")}
      onPointerDown={onPointerDown}
      onDoubleClick={() => store.setSidebarWidth(240)}
    />
  );
}

