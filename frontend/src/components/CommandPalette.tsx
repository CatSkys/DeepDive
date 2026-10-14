// 全局搜索面板（⌘K，版式照参考图 Search for actions）：操作 / 当前会话 / 项目 /
// 会话 / 设置五类统一搜索，回车直达。OpenHost 挂 App 根部，openCommandPalette() /
// toggleCommandPalette() 供键位与其它入口调用。遮罩 / 居中 / 关法（Esc、点外部）走共享
// Modal。版式抄参考图（tinycast 调色板）：列表平铺、**每行尾部标种类**、行内热键
// 用空心键帽紧随标题、头部浮在列表之上、头尾两条按滚动深度渐隐的雾带；行 hover 走
// 全站门控口径（§1.10）。
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Check, Gauge, LayoutGrid, MessageSquare, Mic, PanelLeft, Pin, Plus, Search, Settings, SquarePen, Waves } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useStore } from "../store";
import { getWsIcon, useWsIcon } from "../wsIcons";
import { useT } from "../i18n";
import { comboFor } from "../keybinds";
import { DD_EVENTS, dispatchAppEvent } from "../events";
import { api } from "../api";
import { alertDialog, confirmDialog, promptDialog } from "./DialogHost";
import { sessionTitle } from "../session/sessionTitle";
import { titleHidesSession } from "../session/backgroundSession";
import { WsGlyph } from "./IconPicker";
import { IconProjectAddOutline16 } from "./Icons";
import { ROW_ICON } from "./panelRowIcon";
import { openNewProjectDialog } from "./NewProjectDialog";
import { openDeepDiving } from "../game/store";
import { openGame2048 } from "../game/twenty48/store";
import { SETTINGS_SECTIONS } from "./SettingsPage";
import { Modal } from "./Modal";
import css from "./CommandPalette.module.css";

let openReq: (() => void) | null = null;
let toggleReq: (() => void) | null = null;

/** 打开搜索面板（顶栏搜索钮、面板内动作等入口）。 */
export function openCommandPalette(): void {
  openReq?.();
}

/** 开着的再按一次收起——⌘K 走这条（面板内 Esc / 点外部是另一条关闭路径）。 */
export function toggleCommandPalette(): void {
  toggleReq?.();
}

/** App 根部挂一次：消费 openCommandPalette / toggleCommandPalette 请求。 */
export function CommandPaletteHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    openReq = () => setOpen(true);
    toggleReq = () => setOpen((v) => !v);
    return () => { openReq = null; toggleReq = null; };
  }, []);
  // 面板一开就广播：hoverArming 据此复位——浮层在静止的指针下面出现，那一行的
  // 悬停高亮不是指针选的，得灭掉（此前这条事件只有监听没有发送方，⌘K 开着指
  // 针停在某行上的话，那行会一直亮着）。
  useEffect(() => {
    if (open) dispatchAppEvent(DD_EVENTS.commandPalette);
  }, [open]);
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

/** 一行结果：kind 是它的种类（参考图行尾那个 "Application"），渲染在行的最右。 */
interface PaletteRow {
  row: Row;
  idx: number;
  kind: string;
}

/** 雾带参数（抄参考图 EdgeDissolve）：上带 = 头部 40 + 32 溢入，下带 = 80；
 *  地板值让滚到边的内容仍留一点影，不是硬淡。
 *  **这两个数与 .module.css 的 mask 渐变必须一起改**（那边写的是同一组 px）。 */
const FADE_TOP_PX = 72;
const FADE_BOTTOM_PX = 80;
const FADE_TOP_FLOOR = 0.15;
const FADE_BOTTOM_FLOOR = 0.25;

function CommandPalette({ onClose }: { onClose: () => void }) {
  const { t, tt, lang } = useT();
  const store = useStore();
  // 订阅项目 glyph 变更（map 内只能纯读 getWsIcon，hook 不能进回调）
  useWsIcon(store.workspaces[0]?.workspaceId);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const groups = useMemo<Array<[string, Row[]]>>(() => {
    const q = query.trim().toLowerCase();
    const hit = (label: string) => !q || label.toLowerCase().includes(q);
    const actions: Row[] = [
      { key: "new-project", icon: <IconProjectAddOutline16 size={15} />, label: t("新建项目"), run: () => openNewProjectDialog() },
      { key: "new-session", icon: <SquarePen {...ROW_ICON} />, label: t("新会话"), combo: comboFor("new-session", store.keybinds), run: () => store.openSession(null) },
      { key: "attach", icon: <Plus {...ROW_ICON} />, label: t("添加附件"), run: () => dispatchAppEvent(DD_EVENTS.composerAttach) },
      { key: "dictation", icon: <Mic {...ROW_ICON} />, label: t("听写"), combo: comboFor("dictation", store.keybinds), run: () => dispatchAppEvent(DD_EVENTS.dictationToggle) },
      { key: "cycle-effort", icon: <Gauge {...ROW_ICON} />, label: t("思考强度切换"), combo: comboFor("cycle-effort", store.keybinds), run: () => dispatchAppEvent(DD_EVENTS.cycleEffort) },
      { key: "toggle-sidebar", icon: <PanelLeft {...ROW_ICON} />, label: t("收起 / 展开侧栏"), combo: comboFor("toggle-sidebar", store.keybinds), run: () => store.toggleSidebar() },
      { key: "settings", icon: <Settings {...ROW_ICON} />, label: t("设置"), combo: comboFor("open-settings", store.keybinds), run: () => dispatchAppEvent(DD_EVENTS.openSettings) },
    ].filter((r) => hit(r.label));

    const projects: Row[] = store.workspaces
      .filter((w) => hit(w.title) || hit(w.path))
      .map((w, i) => {
        return {
          key: `ws-${w.workspaceId}`,
          icon: <WsGlyph name={getWsIcon(w.workspaceId)} label={w.title} size={15} />,
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
        icon: <MessageSquare {...ROW_ICON} />,
        label: sessionTitle(s, lang),
        activeMark: s.sessionId === store.activeSessionId,
        run: () => store.openSession(s.sessionId),
      }));

    // 当前会话动作（草稿页无活动会话，整组不出现）
    const sid = store.activeSessionId ?? undefined;
    const current: Row[] = sid ? ([
      { key: "rename-session", icon: <SquarePen {...ROW_ICON} />, label: t("重命名当前会话"), run: () => {
        void promptDialog({ title: t("重命名任务") }).then(async (title) => {
          if (!title || !title.trim()) return;
          const next = title.trim();
          // 同侧栏右键：标题前缀决定列表可见性，改完会消失的先问一句
          if (titleHidesSession(next)) {
            const ok = await confirmDialog({
              title: t("重命名任务"),
              message: t("这个名字以后台会话的保留前缀开头（自动化·／自进化·），改完这个会话会从列表里消失。确定吗？"),
              confirmLabel: t("重命名"),
            });
            if (!ok) return;
          }
          try { await api.sessionRename({ sessionId: sid, title: next }); await store.refresh(); }
          catch (err) { void alertDialog({ message: tt(`重命名失败：${(err as Error).message}`, `Rename failed: ${(err as Error).message}`) }); }
        });
      } },
      { key: "pin-session", icon: <Pin {...ROW_ICON} />, label: t(store.pinned.has(sid) ? "取消置顶" : "置顶"), run: () => store.togglePin(sid) },
      { key: "archive-session", icon: <Archive {...ROW_ICON} />, label: t("归档当前会话"), run: () => {
        void (async () => {
          const err = await store.archiveSession(sid);
          if (err) void alertDialog({ message: tt("归档失败：{m}", "Archive failed: {m}", { m: err }) });
        })();
      } },
    ] as Row[]).filter((r) => hit(r.label)) : [];

    const settings: Row[] = SETTINGS_SECTIONS
      .filter((sec) => hit(t(sec.label)))
      .map((sec) => {
        const Icon = sec.icon;
        return {
          key: `set-${sec.id}`,
          icon: <Icon {...ROW_ICON} />,
          label: t(sec.label),
          run: () => dispatchAppEvent(DD_EVENTS.openSettings, { section: sec.id }),
        };
      });

    // 五类的顺序就是列表顺序；列表平铺，每行尾部标自己的种类（参考图的做法），
    // 所以这里的分组只在建表时用来打 kind，渲染时不再有分组头。
    const games: Row[] = [
      { key: "deepdiving", icon: <Waves {...ROW_ICON} />, label: t("DeepDiving"), run: () => openDeepDiving() },
      { key: "2048", icon: <LayoutGrid {...ROW_ICON} />, label: t("2048"), run: () => openGame2048() },
    ].filter((r) => hit(r.label));

    return [
      [t("操作"), actions],
      [t("游戏"), games],
      [t("当前会话"), current],
      [t("项目"), projects],
      [t("会话"), sessions],
      [t("设置"), settings],
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, store.workspaces, store.sessions, store.activeWorkspaceId, store.activeSessionId, store.keybinds, store.pinned, lang, t]);

  const rows = useMemo<PaletteRow[]>(() => {
    const out: PaletteRow[] = [];
    for (const [kind, list] of groups) {
      for (const row of list) out.push({ row, idx: out.length, kind });
    }
    return out;
  }, [groups]);
  const flat = useMemo(() => rows.map((r) => r.row), [rows]);

  // 过滤结果变化时把焦点收回首项
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    const el = panelRef.current?.querySelector(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // 头尾雾带：按滚动深度写两个 alpha（离边缘越近越透，滚到头仍留地板值），
  // 内容放得下时整条掩码撤下（data-fade="off"）。公式与参考图 EdgeDissolve 同源。
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const sync = () => {
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) {
        el.dataset.fade = "off";
        return;
      }
      delete el.dataset.fade;
      const top = Math.min(el.scrollTop / FADE_TOP_PX, 1);
      const bottom = Math.min((max - el.scrollTop) / FADE_BOTTOM_PX, 1);
      el.style.setProperty("--palette-fade-top", String(1 - (1 - FADE_TOP_FLOOR) * top));
      el.style.setProperty("--palette-fade-bottom", String(1 - (1 - FADE_BOTTOM_FLOOR) * bottom));
    };
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", sync); ro.disconnect(); };
  }, [rows.length]);

  const runRow = (row: Row) => {
    onClose();
    row.run();
  };

  const onInputKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, flat.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter" && flat[active]) { e.preventDefault(); runRow(flat[active]); }
  };

  return (
    <Modal open onClose={onClose} cardClassName={css.panel} ariaLabel={t("搜索")} contentRef={panelRef}>
      <div className={css.searchRow}>
        <Search size={16} />
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
        {rows.map(({ row, idx, kind }) => (
          <button
            key={row.key}
            type="button"
            data-idx={idx}
            className={`${css.row}${idx === active ? ` ${css.active}` : ""}`}
            style={{ "--i": idx } as CSSProperties}
            onClick={() => runRow(row)}
          >
            <span className={css.rowIcon}>{row.icon}</span>
            <span className={css.rowLabel}>{row.label}</span>
            {row.combo && (
              <span className="tip-keys-row outline">
                {[...row.combo].map((ch, i) => <kbd key={i} className="tip-key">{ch}</kbd>)}
              </span>
            )}
            <span className={css.rowTrail}>
              {row.activeMark && <Check size={14} className={css.check} />}
              <span className={css.rowKind}>{kind}</span>
            </span>
          </button>
        ))}
        {flat.length === 0 && <div className={css.empty}>{t("无结果")}</div>}
      </div>
    </Modal>
  );
}

