// 全局命令面板（⌘K，版式照参考图 Search for actions）：操作 / 项目 / 会话 /
// 设置分区统一搜索，回车直达。OpenHost 挂 App 根部，openCommandPalette()
// 供键位与其它入口调用。无全屏遮罩：浮层挂 top-center，点外部 / Esc 关闭。
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { Archive, Check, Folder, Gauge, MessageSquare, Mic, PanelLeft, Pin, Plus, Search, Settings, SquarePen } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useStore } from "../store";
import { getWsIcon, useWsIcon } from "../wsIcons";
import { useT } from "../i18n";
import { comboFor } from "../keybinds";
import { DD_EVENTS, dispatchAppEvent } from "../events";
import { api } from "../api";
import { alertDialog, promptDialog } from "./DialogHost";
import { sessionTitle } from "../session/sessionTitle";
import { wsGlyphIcon } from "./IconPicker";
import { IconProjectAddOutline16 } from "./Icons";
import { openNewProjectDialog } from "./NewProjectDialog";
import { SETTINGS_SECTIONS } from "./SettingsPage";
import css from "./CommandPalette.module.css";

let openReq: (() => void) | null = null;

/** 打开命令面板（App ⌘K 键位等入口）。 */
export function openCommandPalette(): void {
  openReq?.();
}

/** App 根部挂一次：消费 openCommandPalette 请求。 */
export function CommandPaletteHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    openReq = () => setOpen(true);
    return () => { openReq = null; };
  }, []);
  return open ? <CommandPalette onClose={() => setOpen(false)} /> : null;
}

interface Row {
  key: string;
  icon: ReactNode;
  label: string;
  combo?: string;
  /** 当前项标记（当前项目/会话右侧打勾）。 */
  activeMark?: boolean;
  run: () => void;
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const { t, tt, lang } = useT();
  const store = useStore();
  // 订阅项目 glyph 变更（map 内只能纯读 getWsIcon，hook 不能进回调）
  useWsIcon(store.workspaces[0]?.workspaceId);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  const groups = useMemo<Array<Row[]>>(() => {
    const q = query.trim().toLowerCase();
    const hit = (label: string) => !q || label.toLowerCase().includes(q);
    const actions: Row[] = [
      { key: "new-project", icon: <IconProjectAddOutline16 size={15} />, label: t("新建项目"), run: () => openNewProjectDialog() },
      { key: "new-session", icon: <SquarePen size={15} />, label: t("新会话"), combo: comboFor("new-session", store.keybinds), run: () => store.openSession(null) },
      { key: "attach", icon: <Plus size={15} />, label: t("添加附件"), run: () => dispatchAppEvent(DD_EVENTS.composerAttach) },
      { key: "dictation", icon: <Mic size={15} />, label: t("听写"), combo: comboFor("dictation", store.keybinds), run: () => dispatchAppEvent(DD_EVENTS.dictationToggle) },
      { key: "cycle-effort", icon: <Gauge size={15} />, label: t("思考强度切换"), combo: comboFor("cycle-effort", store.keybinds), run: () => dispatchAppEvent(DD_EVENTS.cycleEffort) },
      { key: "search-sessions", icon: <Search size={15} />, label: t("搜索会话全文"), run: () => dispatchAppEvent(DD_EVENTS.focusSearch) },
      { key: "toggle-sidebar", icon: <PanelLeft size={15} />, label: t("收起 / 展开侧栏"), combo: comboFor("toggle-sidebar", store.keybinds), run: () => store.toggleSidebar() },
      { key: "settings", icon: <Settings size={15} />, label: t("设置"), combo: comboFor("open-settings", store.keybinds), run: () => dispatchAppEvent(DD_EVENTS.openSettings) },
    ].filter((r) => hit(r.label));

    const projects: Row[] = store.workspaces
      .filter((w) => hit(w.title) || hit(w.path))
      .map((w, i) => {
        const Glyph = wsGlyphIcon(getWsIcon(w.workspaceId));
        return {
          key: `ws-${w.workspaceId}`,
          icon: Glyph ? <Glyph size={15} /> : <Folder size={15} />,
          label: w.title,
          // ⌥1-9 直达第 N 个空间（与 WsSwitcher 悬浮提示同口径）
          combo: i < 9 ? `⌥${i + 1}` : undefined,
          activeMark: w.workspaceId === store.activeWorkspaceId,
          run: () => store.switchWorkspace(w.workspaceId),
        };
      });

    const sessions: Row[] = store.sessions
      .filter((s) => hit(sessionTitle(s, lang)))
      .slice(0, 20)
      .map((s) => ({
        key: `sess-${s.sessionId}`,
        icon: <MessageSquare size={15} />,
        label: sessionTitle(s, lang),
        activeMark: s.sessionId === store.activeSessionId,
        run: () => store.openSession(s.sessionId),
      }));

    // 当前会话动作（草稿页无活动会话，整组不出现）
    const sid = store.activeSessionId ?? undefined;
    const current: Row[] = sid ? ([
      { key: "rename-session", icon: <SquarePen size={15} />, label: t("重命名当前会话"), run: () => {
        void promptDialog({ title: t("重命名任务") }).then(async (title) => {
          if (!title || !title.trim()) return;
          try { await api.sessionRename({ sessionId: sid, title: title.trim() }); await store.refresh(); }
          catch (err) { void alertDialog({ message: tt(`重命名失败：${(err as Error).message}`, `Rename failed: ${(err as Error).message}`) }); }
        });
      } },
      { key: "pin-session", icon: <Pin size={15} />, label: t(store.pinned.has(sid) ? "取消置顶" : "置顶"), run: () => store.togglePin(sid) },
      { key: "archive-session", icon: <Archive size={15} />, label: t("归档当前会话"), run: () => {
        void (async () => {
          try { await api.workspaceArchiveSession({ sessionId: sid }); await store.refresh(); }
          catch (err) { void alertDialog({ message: tt(`归档失败：${(err as Error).message}`, `Archive failed: ${(err as Error).message}`) }); }
        })();
      } },
    ] as Row[]).filter((r) => hit(r.label)) : [];

    const settings: Row[] = SETTINGS_SECTIONS
      .filter((sec) => hit(t(sec.label)))
      .map((sec) => {
        const Icon = sec.icon;
        return {
          key: `set-${sec.id}`,
          icon: <Icon size={15} />,
          label: t(sec.label),
          run: () => dispatchAppEvent(DD_EVENTS.openSettings, { section: sec.id }),
        };
      });

    return [actions, current, projects, sessions, settings].filter((g) => g.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, store.workspaces, store.sessions, store.activeWorkspaceId, store.activeSessionId, store.keybinds, store.pinned, lang, t]);

  const flat = useMemo(() => groups.flat(), [groups]);
  // 过滤结果变化时把焦点收回首项
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const runRow = (row: Row) => {
    onClose();
    row.run();
  };

  const onInputKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, flat.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter" && flat[active]) { e.preventDefault(); runRow(flat[active]); }
  };

  return createPortal(
    <div className={css.panel} ref={panelRef} role="dialog" aria-label={t("命令面板")}>
      <div className={css.searchRow}>
        <Search size={15} />
        <input
          ref={inputRef}
          autoFocus
          placeholder={t("搜索操作、项目、会话、设置…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
        />
      </div>
      <div className={css.list} ref={listRef}>
        {groups.map((rows, gi) => (
          <div key={gi}>
            {gi > 0 && <div className={css.sep} />}
            {rows.map((row) => {
              const idx = flat.indexOf(row);
              return (
                <button
                  key={row.key}
                  type="button"
                  data-idx={idx}
                  className={`${css.row}${idx === active ? ` ${css.active}` : ""}`}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => runRow(row)}
                >
                  <span className={css.rowIcon}>{row.icon}</span>
                  <span className={css.rowLabel}>{row.label}</span>
                  {row.activeMark && <Check size={14} className={css.check} />}
                  {row.combo && (
                    <span className="tip-keys-row">
                      {[...row.combo].map((ch, i) => <kbd key={i} className="tip-key">{ch}</kbd>)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        {flat.length === 0 && <div className={css.empty}>{t("无结果")}</div>}
      </div>
    </div>,
    document.body,
  );
}

