import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ChevronDown, Ellipsis, Folder, Pin, Plus, Search, Settings, SquarePen, Trash2 } from "lucide-react";
import { IconProjectAddOutline16 } from "./Icons";
import { InlineLoader } from "./LoadingState";
import { api } from "../api";
import { sendToShell } from "../host";
import { useStore } from "../store";
import { useT } from "../i18n";
import { HoverScrollText } from "./HoverScrollText";
import { pickNewWorkspace } from "./workspacePicker";
import type { SessionSummary, WorkspaceView } from "../types";
import { sessionTitle } from "../session/sessionTitle";

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

/** 顶栏工作空间胶囊（收起态专用、纯展示不可点）：文件夹图标 + 项目名，样式
 *  对齐官方 UI 顶栏。展开态由 CSS 隐藏——项目名那时常驻侧栏顶部。 */
export function WorkspacePill() {
  const store = useStore();
  const ws = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId);
  if (!ws) return null;
  return (
    <span className="ws-pill">
      <Folder size={12} />
      <span className="ws-pill-name">{ws.title}</span>
    </span>
  );
}

export function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const store = useStore();
  const [query, setQuery] = useState("");
  const [ctx, setCtx] = useState<CtxMenu | null>(null);
  // 全文搜索（4.1）：引擎 session.search（标题∪正文）。内容命中随防抖
  // 异步到达；禁用部署（无 --patch 放行）下请求失败 → 静默降级 title-only。
  const [contentHits, setContentHits] = useState<Map<string, string>>(new Map());
  // 项目行：会话列表折叠（点行切换）与 ⋯ 菜单（重命名/删除工作区）。
  const [wsCollapsed, setWsCollapsed] = useState(false);
  const [wsCtx, setWsCtx] = useState<{ x: number; y: number } | null>(null);

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
      return;
    }
    const seq = ++searchReqRef.current;
    const timer = setTimeout(() => {
      void api.search({ query: trimmedQuery }).then((r) => {
        if (searchReqRef.current !== seq) return;
        setContentHits(new Map(r.items.map((x) => [x.sessionId, x.snippet])));
      }).catch(() => {
        // 引擎未放行 session.query 索引（DSH-WIRE §1）：保持 title-only
        if (searchReqRef.current === seq) setContentHits(new Map());
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [trimmedQuery]);

  // 项目行 ⋯ 菜单动作（官方 ProjectRowItem 的 rename/delete 同款）。
  const renameWorkspace = (ws: WorkspaceView) => {
    setWsCtx(null);
    const title = prompt(t("重命名"), ws.title);
    if (!title || !title.trim()) return;
    void (async () => {
      try { await api.workspaceRename({ workspaceId: ws.workspaceId, title: title.trim() }); await store.refresh(); }
      catch (err) { alert(tt(`重命名失败：${(err as Error).message}`, `Rename failed: ${(err as Error).message}`)); }
    })();
  };
  const deleteWorkspace = (ws: WorkspaceView) => {
    setWsCtx(null);
    if (!confirm(tt(`删除工作空间「${ws.title}」？\n（只解除项目归属，磁盘上的文件夹不会被删除）`, `Delete workspace “${ws.title}”?\n(Only detaches the project; files on disk and sessions are kept)`))) return;
    void (async () => {
      try {
        await api.workspaceDelete({ workspaceId: ws.workspaceId });
        const rest = store.workspaces.filter((w) => w.workspaceId !== ws.workspaceId);
        // 删除的是当前空间 → 落到第一个剩余空间；全删光则回单列表模式。
        if (store.activeWorkspaceId === ws.workspaceId && rest[0]) store.switchWorkspace(rest[0].workspaceId);
        await store.refresh();
      } catch (err) { alert(tt(`删除失败：${(err as Error).message}`, `Delete failed: ${(err as Error).message}`)); }
    })();
  };

  // 会话 → 空间归属：不在任何空间的会话按惯例归第一个空间；引擎没有工作
  // 空间面时（hasWs=false）全部会话视为"当前空间"，退回单列表行为。
  const { t, tt, lang } = useT();
  const hasWs = store.workspaces.length > 0;
  const wsOf = (s: SessionSummary): string | undefined =>
    hasWs ? (store.wsOfSession.get(s.sessionId) ?? store.workspaces[0].workspaceId) : undefined;
  const activeWs = store.workspaces.find((w) => w.workspaceId === store.activeWorkspaceId);

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

  // 当前空间视图：时间分组。blank 会话不滤——新建的会话要以 "New Chat"
  // 出现在侧栏顶部（§2.2）。置顶会话独立成组浮在分组之前。subagent 派生
  // 会话不进会话栏（引擎自动创建的工作单元，入口在状态胶囊/父会话）。
  const groups = useMemo<Array<{ label: string; items: SessionSummary[] }>>(() => {
    if (query.trim()) return [];
    const list = store.sessions.filter((s) => s.origin !== "subagent" && (!hasWs || wsOf(s) === store.activeWorkspaceId));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, store.sessions, store.workspaces, store.activeWorkspaceId, store.wsOfSession, store.pinned]);

  // 搜索视图：全空间结果，按来源项目分组（§2.5）；标题命中 + 全文命中
  // 去重合并（标题命中优先，内容命中带 snippet 行）；点击经 openSession
  // 自动切到所属空间。
  const searchGroups = useMemo<Array<{ label: string; items: SessionSummary[] }>>(() => {
    if (!query) return [];
    const q = query.trim().toLowerCase();
    const visible = store.sessions.filter((s) => s.origin !== "subagent");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, store.sessions, store.workspaces, store.wsOfSession, contentHits]);

  // 判定"是否在搜索"必须用 trim 后的值：搜索框残留一个空格时原始 query
  // 为真值、而 trim 后的空串会命中全部会话 —— 曾把跨空间搜索视图退化成
  // "所有工作空间的内容混铺一屏"（用户报告的混屏根因）。
  const view = query.trim() ? searchGroups : groups;

  const renderRow = (s: SessionSummary, snippet?: string) => (
    <button
      key={s.sessionId}
      className={`task-row${s.sessionId === store.activeSessionId ? " selected" : ""}${s.running ? " running" : ""}${store.unread.has(s.sessionId) ? " unread" : ""}`}
      onClick={() => store.openSession(s.sessionId)}
      onContextMenu={(e) => {
        e.preventDefault();
        setCtx({ sessionId: s.sessionId, title: sessionTitle(s, lang), cwd: s.cwd, x: e.clientX, y: e.clientY });
      }}
    >
      <span className="row-slot" aria-hidden="true">
        {s.running ? (
          <InlineLoader />
        ) : (
          store.unread.has(s.sessionId) && <span className="unread-dot" />
        )}
      </span>
      <span className="row-main">
        <HoverScrollText className="title">{sessionTitle(s, lang)}</HoverScrollText>
        {snippet && <span className="row-snippet">{snippet}</span>}
      </span>
      {store.pinned.has(s.sessionId) && <Pin size={11} className="row-pin" aria-hidden="true" />}
      <span className="row-actions"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setCtx({ sessionId: s.sessionId, title: sessionTitle(s, lang), cwd: s.cwd, x: e.clientX, y: e.clientY });
        }}
      >
        <span className="row-time">{fmtTime(s.updatedAt, lang)}</span>
        <button
          className="row-archive"
          data-tip={t("归档任务")}
          onClick={async () => {
            try { await api.workspaceArchiveSession({ sessionId: s.sessionId }); await store.refresh(); } catch { /* surfaced by poll */ }
          }}
        >
          <Archive size={13} />
        </button>
      </span>
    </button>
  );

  return (
    <aside className="sidebar">
      <div className="search-row">
        <Search size={14} />
        <input
          placeholder={t("搜索")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {activeWs && (
        <div className="ws-view" key={`head-${activeWs.workspaceId}`} data-dir={slideDir.current}>
          {/* 官方 ProjectRowItem 同款交互：点行折叠/展开会话；hover 显出
              chevron（替代文件夹图标，折叠时转 -90°）与 ⋯/＋ 行尾按钮。 */}
          <div
            className={`ws-row${wsCollapsed ? " collapsed" : ""}`}
            role="treeitem"
            aria-expanded={!wsCollapsed}
           
            onClick={() => setWsCollapsed((v) => !v)}
          >
            <span className="ws-lead" aria-hidden="true">
              <Folder size={13} className="ws-folder-ic" />
              <ChevronDown size={13} className="ws-chevron-ic" />
            </span>
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
              <button className="ws-act" data-tip={t("新建会话")} onClick={() => store.openSession(null)}>
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
        <div className="sessions">
          {view.map(({ label, items }) => (
            <div key={label}>
              {label && <div className="section-label">{label}</div>}
              {items.map((s) => renderRow(s, !query.trim() ? undefined : contentHits.get(s.sessionId)))}
            </div>
          ))}
          {view.length === 0 && (
            <div className="empty-state">{query ? t("无结果") : t("暂无会话")}</div>
          )}
        </div>
      </div>
      <div className="sidebar-foot">
        <button
          className="settings-entry"
          data-tip={t("设置")}
          data-tip-keys="⌘,"
          onClick={() => {
            onOpenSettings();
          }}
        >
          <Settings size={15} />
        </button>
        {hasWs && (
          <div className="ws-switcher">
            {store.workspaces.map((w) => (
              <button
                key={w.workspaceId}
                className={`ws-cell${w.workspaceId === store.activeWorkspaceId ? " active" : ""}`}
                data-tip={w.title}
                onClick={() => store.switchWorkspace(w.workspaceId)}
              >
                {(w.title.trim()[0] ?? "?").toUpperCase()}
              </button>
            ))}
          </div>
        )}
        {/* ＋新建空间：共享入口 workspacePicker（壳端目录选择器，纯浏览器
            退化为手输绝对路径；Hero 项目菜单同源）。 */}
        <button
          className="ws-add"
          data-tip={t("新建项目空间")}
          onClick={() => pickNewWorkspace(
            !!window.webkit?.messageHandlers?.deepdiveHost,
            t("输入要添加为工作空间的文件夹绝对路径："),
            (p) => void store.createWorkspace(p),
          )}
        >
          <IconProjectAddOutline16 size={15} />
        </button>
      </div>
      {wsCtx && activeWs && (
        <div className="ctx-menu" style={{ top: wsCtx.y, left: Math.min(wsCtx.x, window.innerWidth - 200) }} onClick={(e) => e.stopPropagation()}>
          <div className="ctx-item" onClick={() => renameWorkspace(activeWs)}>
            <SquarePen size={13} /> {t("重命名")}
          </div>
          <div className="ctx-item danger" onClick={() => deleteWorkspace(activeWs)}>
            <Trash2 size={13} /> {t("删除工作区")}
          </div>
        </div>
      )}
      {ctx && (
        <div className="ctx-menu" style={{ top: ctx.y, left: Math.min(ctx.x, window.innerWidth - 220) }} onClick={(e) => e.stopPropagation()}>
          <div className="ctx-item" onClick={() => {
            const title = prompt(t("重命名任务"), ctx.title);
            if (title && title.trim()) {
              void (async () => {
                try { await api.sessionRename({ sessionId: ctx.sessionId, title: title.trim() }); await store.refresh(); } catch (err) { alert(tt(`重命名失败：${(err as Error).message}`, `Rename failed: ${(err as Error).message}`)); }
              })();
            }
            setCtx(null);
          }}>{t("重命名任务")}</div>
          <div className="ctx-item" onClick={async () => {
            try { await api.workspaceArchiveSession({ sessionId: ctx.sessionId }); await store.refresh(); } catch (err) { alert(`归档失败：${(err as Error).message}`); }
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

