import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, Brain, CalendarClock, ChartColumn, ChevronLeft, Cpu, Dna, Download, Folder, Keyboard, Moon,
  GitBranch, MessagesSquare, Monitor, Puzzle, Search, Settings as SettingsIcon, ShieldAlert, ShieldCheck,
  Smartphone,
  SquarePen, Sun,
  Trash2,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import rowsCss from "../settings/SettingsRows.module.css";
import { Dropdown, Toggle } from "../components/controls";
import { ModelsManage } from "../settings/ModelsManage";
import { ImportSection } from "../settings/ImportSection";
import { UsageSection } from "../stats/UsageSection";
import { AutomationSection } from "../automation/AutomationSection";
import { MemorySection } from "../memory/MemorySection";
import { PluginsSection } from "../plugins/PluginsSection";
import { shortModuleName } from "../plugins/model";
import { draftKeyOf, writeDraft } from "../components/composer/useComposerDraft";
import { CollabSection } from "../collab/CollabSection";
import { WorktreeSection } from "../worktree/WorktreeSection";
import { RemoteControlSection } from "../mobile/RemoteControlSection";
import { EvolutionSection } from "../evolution/EvolutionSection";
import type { AutomationProposal } from "../automation/protocol";
import { permissionPresetView, type PermissionSettingsView } from "../settings/permissionPreset";
import { SettingsConflictError, useSettingNamespace } from "../settings/useSettingNamespace";
import { RETENTIONS, retentionLabel, type ArchiveRetention } from "../autoArchive";
import { api } from "../api";
import { comboFor, comboOf, isOff, KEYBIND_DEFS } from "../keybinds";
import { onHostEvent, sendToShell } from "../host";
import { useStore } from "../store";
import { sessionTitle } from "../session/sessionTitle";
import { buildArchivedGroups, filterArchivedGroups, UNGROUPED, type ArchivedGroup } from "../settings/archivedGroups";
import { useT } from "../i18n";
import { alertDialog, confirmDialog } from "./DialogHost";
import { sessionDeleteDirs } from "../host";

// 设置页 —— 与主界面同一套设计体系：主界面语义变量 + 统一弹出配方 +
// 复用 Dropdown/Toggle 组件；不再使用官方 dsh settings 面板的独立
// token 体系（dsw-alias 已废除）。数据全部走真实路由，无引擎时各
// section 独立降级。
//
// 分类（侧栏按用途分三组；组定义与成员见下方 navGroups）：
//   基础设置——通用（外观/语言/归档/Enter/通知）、模型（提供方+密钥）、审批（默认权限预设）、快捷键
//   Agent 能力——自动化、记忆、自进化、技能与插件、会话协作、移动端远程控制、导入
//   数据与统计——已归档的聊天、数据、工作树、使用统计

export function SettingsPage({ initialSection, onClose, automationDraft, onAutomationDraftUsed }: {
  initialSection?: string;
  onClose: () => void;
  /** 会话里提出的定时任务建议（App 经消息流事件收到后透传进来）。 */
  automationDraft?: AutomationProposal | null;
  onAutomationDraftUsed?: () => void;
}) {
  const { t, tt } = useT();
  const store = useStore();
  const [activeId, setActiveId] = useState(initialSection ?? "general");
  /** 当前分区注入页头右侧的批量动作（切分区即清空）：只收数据与回调，按钮由页头渲染。 */
  const [bulk, setBulk] = useState<{ count: number; onDelete: () => void } | null>(null);
  // 不在切分区时清：React 的 effect 自底向上，父的清理会晚于子的上报、把按钮抹掉；
  // 由分区卸载时的 cleanup（onBulk(null)）收尾。

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 分区按用途分组（项多到一个平铺列表读不动）：组的顺序即侧栏阅读顺序。
  // 组标签复用侧栏既有的 .section-label（会话列表的「置顶/今天」同款），
  // 不另造一套分组样式。
  const navGroups = [
    {
      label: t("基础设置"),
      items: [
        { id: "general", label: t("通用"), icon: SettingsIcon },
        { id: "models", label: t("模型"), icon: Cpu },
        { id: "approval", label: t("审批"), icon: ShieldCheck },
        { id: "hotkeys", label: t("快捷键"), icon: Keyboard },
      ],
    },
    {
      label: t("Agent 能力"),
      items: [
        { id: "automation", label: t("自动化"), icon: CalendarClock },
        { id: "memory", label: t("记忆"), icon: Brain },
        { id: "evolution", label: t("自进化"), icon: Dna },
        { id: "plugins", label: t("插件"), icon: Puzzle },
        { id: "collab", label: t("会话协作"), icon: MessagesSquare },
        { id: "remote", label: t("移动端远程控制"), icon: Smartphone },
        { id: "import", label: t("导入"), icon: Download },
      ],
    },
    {
      label: t("数据与统计"),
      items: [
        { id: "archived", label: t("已归档的聊天"), icon: Archive },
        { id: "data", label: t("数据"), icon: Folder },
        { id: "worktree", label: t("工作树"), icon: GitBranch },
        { id: "usage", label: t("使用统计"), icon: ChartColumn },
      ],
    },
  ];
  const nav = navGroups.flatMap((g) => g.items);
  const active = nav.find((n) => n.id === activeId) ?? nav[0];

  // 不是覆盖层：侧栏仍是同一个 .sidebar（同一层 chrome 背景），主区仍是
  // 同一个 .main 卡片（同一 --card-gradient/圆角/描边）—— 只是内容换成了
  // 设置。颜色/样式与主界面"字面相同"，因为它就是同一批元素。
  return (
    <>
      <nav className="sidebar" aria-label={t("设置")}>
        <button className="snav-back" onClick={onClose}>
          <ChevronLeft size={15} />
          {t("返回工作区")}
        </button>
        {navGroups.map((group) => (
          <div key={group.label} className="snav-group">
            <div className="section-label">{group.label}</div>
            {group.items.map((n) => (
              <button
                key={n.id}
                className={`snav-item${n.id === activeId ? " active" : ""}`}
                onClick={() => setActiveId(n.id)}
              >
                <n.icon size={15} />
                {n.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <main className="main" aria-label={t("设置")}>
        <div className="settings-content">
          <div className="settings-head">
            <div className="settings-title">{active.label}</div>
            {/* 分区自带动作（如归档页的「全部删除」）占原关闭叉的位置；
                返回工作区由侧栏顶部的 snav-back 承担，右上不需要叉 */}
            {bulk !== null && (
              <button
                type="button"
                className={rowsCss.archDanger}
                disabled={bulk.count === 0}
                onClick={() => bulk.onDelete()}
              >
                <Trash2 size={13} />
                {t("全部删除")}
              </button>
            )}
          </div>
          {activeId === "general" && <GeneralSection />}
          {activeId === "models" && <ModelsManage />}
          {/* 自动化：历史里点「打开会话」要离开设置页去看那次转录 */}
          {activeId === "evolution" && (
            <EvolutionSection onOpenSession={(sessionId) => { onClose(); store.openSession(sessionId); }} />
          )}
          {activeId === "memory" && <MemorySection />}
          {activeId === "plugins" && (
            <PluginsSection
              onTryPlugin={(moduleName) => {
                // 「立即试用」= 回新会话页 + 预填一条提问（用户可改可发）。
                // 草稿写在 hero 键上：关掉设置页后 Composer 重新挂载会读回它。
                writeDraft(
                  draftKeyOf(null, store.activeWorkspaceId),
                  tt("{name} 是什么？用它演示一下", "What is {name}? Show me what it does", { name: shortModuleName(moduleName) }),
                );
                store.openSession(null);
                onClose();
              }}
            />
          )}
          {activeId === "collab" && <CollabSection />}
          {activeId === "worktree" && <WorktreeSection />}
          {activeId === "remote" && <RemoteControlSection />}
          {activeId === "automation" && (
            <AutomationSection
              onOpenSession={(sessionId) => { onClose(); store.openSession(sessionId); }}
              initialDraft={automationDraft}
              onDraftUsed={onAutomationDraftUsed}
            />
          )}
          {activeId === "import" && <ImportSection />}
          {activeId === "approval" && <ApprovalSection />}
          {activeId === "hotkeys" && <HotkeysSection />}
          {activeId === "archived" && <ArchivedSection onBulk={setBulk} />}
          {activeId === "data" && <DataSection />}
          {activeId === "usage" && <UsageSection />}
        </div>
      </main>
    </>
  );
}

/* ───────────────────────── 通用 ───────────────────────── */

function GeneralSection() {
  const { t, tt } = useT();
  const store = useStore();
  const [prefs, setPrefs] = useState({ notifyTurnEnd: true, notifyAttention: true, menuBar: true, dockIcon: true, bubble: true });
  const [busy, setBusy] = useState<string | undefined>(undefined);

  useEffect(() => {
    sendToShell({ type: "get-prefs" });
    return onHostEvent((cmd, payload) => {
      if (cmd === "prefs" && payload) {
        const p = payload as Partial<typeof prefs>;
        if (p.notifyTurnEnd !== undefined) setPrefs((c) => ({ ...c, notifyTurnEnd: p.notifyTurnEnd! }));
        if (p.notifyAttention !== undefined) setPrefs((c) => ({ ...c, notifyAttention: p.notifyAttention! }));
        if (p.menuBar !== undefined) setPrefs((c) => ({ ...c, menuBar: p.menuBar! }));
        if (p.dockIcon !== undefined) setPrefs((c) => ({ ...c, dockIcon: p.dockIcon! }));
        if (p.bubble !== undefined) setPrefs((c) => ({ ...c, bubble: p.bubble! }));
      }
    });
  }, []);
  const changeNotify = (key: "notifyTurnEnd" | "notifyAttention" | "menuBar" | "dockIcon" | "bubble", value: boolean) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    sendToShell({ type: "set-pref", key, value });
  };

  const { describe: describeUiNs, update: updateUiNs } = useSettingNamespace("ui-conversation");

  useEffect(() => {
    void (async () => {
      try {
        const v = ((await describeUiNs())?.value as { busyEnter?: string } | null)?.busyEnter;
        if (v) setBusy(v);
      } catch { /* engine booting */ }
    })();
  }, [describeUiNs]);
  const saveBusy = async (v: string) => {
    setBusy(v);
    try {
      await updateUiNs({ busyEnter: v });
    } catch (err) {
      void alertDialog(err instanceof SettingsConflictError
        ? { message: t("版本已前进——请取消后重新打开(将载入最新)") }
        : { message: tt("保存失败：{m}", "Save failed: {m}", { m: (err as Error).message }) });
    }
  };

  const modes = [
    { v: "light", label: t("亮色"), icon: Sun },
    { v: "dark", label: t("暗色"), icon: Moon },
    { v: "system", label: t("跟随系统"), icon: Monitor },
  ];

  return (
    <>
      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("外观")}</div>
        <div className={rowsCss.sectionIntro}>{t("亮色下侧栏偏灰、会话卡偏白。")}</div>
        <div className={rowsCss.appearanceCards}>
          {modes.map((m) => (
            <button
              key={m.v}
              className={`${rowsCss.appearanceCard}${store.appearance === m.v ? ` ${rowsCss.active}` : ""}`}
              onClick={() => store.setAppearance(m.v as "system" | "light" | "dark")}
            >
              <m.icon size={18} />
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className={rowsCss.section}>
        <div className={rowsCss.rowGroup}>
          <div className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("语言")}</div>
            </div>
            <div className={rowsCss.rowActions}>
              <Dropdown
                options={[{ v: "zh", label: t("中文（简体）") }, { v: "en", label: t("English") }]}
                value={store.lang}
                onChange={(v) => store.setLang(v as "zh" | "en")}
              />
            </div>
          </div>
          <div className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("繁忙时 Enter 键行为")}</div>
              <div className={rowsCss.rowCaption}>{t("仅在智能体运行时生效;Cmd/Ctrl+Enter 使用另一行为")}</div>
            </div>
            <div className={rowsCss.rowActions}>
              <Dropdown
                options={[{ v: "steer", label: t("插话发送") }, { v: "queue", label: t("排队") }]}
                value={busy ?? ""}
                onChange={(v) => void saveBusy(v)}
              />
            </div>
          </div>
        </div>
        <div className={rowsCss.sectionTitle}>{t("归档")}</div>
        <div className={rowsCss.rowGroup}>
          <div className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("自动归档旧任务")}</div>
              <div className={rowsCss.rowCaption}>{t("定时扫描最近打开过的工作区，将已完成、无未读、未置顶且超过保留期的任务自动归档。")}</div>
            </div>
            <div className={rowsCss.rowActions}>
              <Toggle on={store.autoArchive} onChange={store.setAutoArchive} />
            </div>
          </div>
          <div className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("归档保留时长")}</div>
              <div className={rowsCss.rowCaption}>{t("任务最后更新时间早于该时长后，才会进入自动归档候选。")}</div>
            </div>
            <div className={rowsCss.rowActions}>
              <Dropdown
                options={RETENTIONS.map((r) => ({ v: r.id, label: t(retentionLabel(r.id)) }))}
                value={store.archiveRetention}
                onChange={(v) => store.setArchiveRetention(v as ArchiveRetention)}
              />
            </div>
          </div>
        </div>
      </div>
      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("通知")}</div>
        <div className={rowsCss.rowGroup}>
        <div className={rowsCss.rowCard}>
          <div className={rowsCss.rowIdentity}>
            <div className={rowsCss.rowName}>{t("回合完成")}</div>
            <div className={rowsCss.rowCaption}>{t("静默通知，不打扰")}</div>
          </div>
          <div className={rowsCss.rowActions}>
            <Toggle on={prefs.notifyTurnEnd} onChange={(v) => changeNotify("notifyTurnEnd", v)} />
          </div>
        </div>
        <div className={rowsCss.rowCard}>
          <div className={rowsCss.rowIdentity}>
            <div className={rowsCss.rowName}>{t("待审批 / 待提问")}</div>
            <div className={rowsCss.rowCaption}>{t("通知 + Dock 弹跳")}</div>
          </div>
          <div className={rowsCss.rowActions}>
            <Toggle on={prefs.notifyAttention} onChange={(v) => changeNotify("notifyAttention", v)} />
          </div>
        </div>
        <div className={rowsCss.rowCard}>
          <div className={rowsCss.rowIdentity}>
            <div className={rowsCss.rowName}>{t("菜单栏图标")}</div>
            <div className={rowsCss.rowCaption}>{t("实时反映引擎与任务状态")}</div>
          </div>
          <div className={rowsCss.rowActions}>
            <Toggle on={prefs.menuBar} onChange={(v) => changeNotify("menuBar", v)} />
          </div>
        </div>
        <div className={rowsCss.rowCard}>
          <div className={rowsCss.rowIdentity}>
            <div className={rowsCss.rowName}>{t("Dock 栏图标")}</div>
            <div className={rowsCss.rowCaption}>{t("隐藏后不经 Dock 与 Cmd⌘-Tab 显示")}</div>
          </div>
          <div className={rowsCss.rowActions}>
            <Toggle on={prefs.dockIcon} onChange={(v) => changeNotify("dockIcon", v)} />
          </div>
        </div>
        <div className={rowsCss.rowCard}>
          <div className={rowsCss.rowIdentity}>
            <div className={rowsCss.rowName}>{t("悬浮球")}</div>
            <div className={rowsCss.rowCaption}>{t("常驻置顶，单击回主窗")}</div>
          </div>
          <div className={rowsCss.rowActions}>
            <Toggle on={prefs.bubble} onChange={(v) => changeNotify("bubble", v)} />
          </div>
        </div>
        </div>
      </div>
    </>
  );
}

/* ───────────────────────── 审批 ───────────────────────── */

/// 默认权限预设（permission.defaultPreset）：引擎在新会话创建时按此 pin
/// 初始权限；运行中的会话不受影响。选项枚举来自 schema（见 permissionPreset.ts）；
/// 已知预设给本地化标签/说明/图标（UI 参考官方权限菜单），未知预设退回引擎原文。
const PRESET_META: Record<string, { label: string; desc: string; icon: LucideIcon; danger?: boolean }> = {
  "read-only": { label: "只读", desc: "只读取与分析，不改文件。", icon: ShieldCheck },
  "workspace-write": { label: "工作区写入", desc: "工作区内自动改文件，越界先确认。", icon: SquarePen },
  "danger-full-access": { label: "完全访问", desc: "全部可写，不再逐步确认。", icon: ShieldAlert, danger: true },
};

function ApprovalSection() {
  const { t, tt } = useT();
  // undefined=载入中，null=引擎未提供 permission 命名空间
  const [view, setView] = useState<PermissionSettingsView | null | undefined>(undefined);
  const { describe: describePermNs, update: updatePermNs } = useSettingNamespace("permission");

  const load = useCallback(async () => {
    try {
      setView(permissionPresetView(await describePermNs()));
    } catch { /* engine booting: stay loading */ }
  }, [describePermNs]);
  useEffect(() => { void load(); }, [load]);

  const setDefault = async (v: string) => {
    setView((cur) => (cur ? { ...cur, current: v } : cur));
    try {
      await updatePermNs({ defaultPreset: v });
    } catch (err) {
      void alertDialog(err instanceof SettingsConflictError
        ? { message: t("版本已前进——请取消后重新打开(将载入最新)") }
        : { message: tt("保存失败：{m}", "Save failed: {m}", { m: (err as Error).message }) });
    }
    await load();
  };

  const options = (view?.options ?? []).map((o) => {
    const meta = PRESET_META[o.value];
    return {
      v: o.value,
      label: meta ? t(meta.label) : o.label,
      description: meta ? t(meta.desc) : undefined,
      icon: meta?.icon,
      danger: meta?.danger,
    };
  });

  return (
    <div className={rowsCss.section}>
      <div className={rowsCss.sectionIntro}>{t("控制新会话的文件写入与审批策略；运行中的会话保持开始时的预设。")}</div>
      {view === undefined && <div className={rowsCss.muted}>{t("载入中…")}</div>}
      {view === null && <div className={rowsCss.muted}>{t("本引擎未提供权限预设。")}</div>}
      {view && (
        <div className={rowsCss.rowGroup}>
          <div className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("默认权限预设")}</div>
              <div className={rowsCss.rowCaption}>{t("新建会话的初始权限。")}</div>
            </div>
            <div className={rowsCss.rowActions}>
              <Dropdown options={options} value={view.current} onChange={(v) => void setDefault(v)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── 快捷键 ───────────────────────── */

function HotkeysSection() {
  const { t, tt } = useT();
  const store = useStore();
  const { keybinds, setKeybinds } = store;
  const [hotkey, setHotkey] = useState("⌥Space");
  const [recording, setRecording] = useState(false);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd === "hotkeyChanged" && payload) {
      setHotkey((payload as { spec?: string }).spec ?? hotkey);
      setRecording(false);
    }
  }), [hotkey]);

  // 录制期捕获任意按键：Esc 取消；与他启用项冲突则拒绝并提示
  useEffect(() => {
    if (!recordingId) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setRecordingId(null); setConflict(null); return; }
      const combo = comboOf(e);
      if (!combo) return;
      const clash = KEYBIND_DEFS.find(
        (d) => d.id !== recordingId && !isOff(d.id, keybinds) && comboFor(d.id, keybinds) === combo,
      );
      if (clash) { setConflict(tt("与「{n}」冲突", "Conflicts with \"{n}\"", { n: tt(clash.zh, clash.en) })); return; }
      setConflict(null);
      setKeybinds({ ...keybinds, [recordingId]: { combo } });
      setRecordingId(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recordingId, keybinds, setKeybinds, t, tt]);

  const toggleBind = (id: string) =>
    setKeybinds({ ...keybinds, [id]: { combo: comboFor(id, keybinds), off: !isOff(id, keybinds) } });

  return (
    <div className={rowsCss.section}>
      <div className={rowsCss.hotkeyCard}>
        <div className={rowsCss.hotkeyRow}>
          <div className={rowsCss.rowIdentity}>
            <div className={rowsCss.rowName} style={!store.hotkeyOn ? { color: "var(--ink-3)" } : undefined}>
              {t("唤起面板")}
              <span className={rowsCss.metaTag}>{t("全局")}</span>
            </div>
          </div>
          <div className={rowsCss.rowActions}>
            <button
              type="button"
              className={`${rowsCss.comboChip}${recording ? ` ${rowsCss.recording}` : ""}${!store.hotkeyOn ? ` ${rowsCss.off}` : ""}`}
              onClick={() => { if (store.hotkeyOn && !recording) { setRecording(true); sendToShell({ type: "rebind-hotkey" }); } }}
              aria-label={t("修改快捷键")}
            >
              {recording ? t("录制中…") : hotkey}
            </button>
            <Toggle on={store.hotkeyOn} onChange={(v) => store.setHotkeyOn(v)} />
          </div>
        </div>
        {KEYBIND_DEFS.map((def) => {
          const combo = comboFor(def.id, keybinds);
          const off = isOff(def.id, keybinds);
          const isRec = recordingId === def.id;
          return (
            <div key={def.id} className={rowsCss.hotkeyRow}>
              <div className={rowsCss.rowIdentity}>
                <div className={rowsCss.rowName} style={off ? { color: "var(--ink-3)" } : undefined}>{tt(def.zh, def.en)}</div>
              </div>
              <div className={rowsCss.rowActions}>
                <button
                  type="button"
                  className={`${rowsCss.comboChip}${isRec ? ` ${rowsCss.recording}` : ""}${off ? ` ${rowsCss.off}` : ""}`}
                  onClick={() => { setConflict(null); setRecordingId(def.id); }}
                  aria-label={t("修改快捷键")}
                >
                  {isRec ? t("按下新组合…") : combo}
                </button>
                <Toggle on={!off} onChange={() => toggleBind(def.id)} />
              </div>
            </div>
          );
        })}
        {conflict && <div className={rowsCss.modelError} style={{ padding: "0 14px 10px" }}>{conflict}</div>}
      </div>
    </div>
  );
}

/* ───────────────────────── 已归档的聊天 ───────────────────────── */

export function ArchivedSection({ onBulk }: { onBulk?: (bulk: { count: number; onDelete: () => void } | null) => void }) {
  const { t, tt, lang } = useT();
  const store = useStore();
  const { workspaces, archived } = store;
  const [groups, setGroups] = useState<ArchivedGroup[] | null>(null);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");

  // 归档全集与工作空间均来自 store 的 workspace follow 流；会话标题要一次
  // session/list 投影，这里按需拉取（低频设置页，不值得进 store）。
  const load = useCallback(async () => {
    const ss = await api.sessions();
    setGroups(
      buildArchivedGroups(
        workspaces,
        ss.items ?? [],
        [...archived],
        (s) => sessionTitle(s, lang),
        t("无项目"),
      ),
    );
    // t 经 useT 按 lang 缓存为稳定引用（i18n.ts tFuncCache），入表不会触发每渲染重跑
  }, [t, lang, workspaces, archived]);

  useEffect(() => {
    void load().catch(() => setGroups([]));
  }, [load]);

  /** 取消归档：本地覆盖即时生效（引擎状态在下次启动空窗期收敛），无需确认。 */
  const restore = (sessionId: string) => store.unarchiveSession(sessionId);

  /** 删除：本地即时摘掉 + 请壳立刻删日志目录（毫秒级，不重启引擎）。 */
  const remove = async (sessionIds: string[]) => {
    if (sessionIds.length === 0) return;
    for (const sessionId of sessionIds) store.removeSession(sessionId);
    const unarchived = [...store.unarchived];
    const removed = [...store.removed, ...sessionIds];
    const result = await sessionDeleteDirs({ sessionIds, unarchived, removed });
    if (result.error) {
      void alertDialog({ message: tt("部分聊天记录未能删除：{m}", "Some transcripts could not be deleted: {m}", { m: result.error }) });
    }
  };

  const deleteOne = async (sessionId: string) => {
    const ok = await confirmDialog({
      title: t("删除会话"),
      message: t("删除后该会话的聊天记录将从本机移除，无法恢复。"),
      confirmLabel: t("删除"),
    });
    if (ok) void remove([sessionId]);
  };

  const deleteAll = async () => {
    const ids = visible.flatMap((g) => g.rows.map((r) => r.sessionId));
    if (ids.length === 0) return;
    const ok = await confirmDialog({
      title: t("全部删除"),
      message: tt("将删除 {n} 个已归档会话的聊天记录，无法恢复。", "Deletes {n} archived chats for good.", { n: ids.length }),
      confirmLabel: t("删除"),
    });
    if (ok) void remove(ids);
  };

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
      year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
    }),
    [lang],
  );

  const visible = useMemo(
    () => filterArchivedGroups(groups ?? [], query, project),
    [groups, query, project],
  );

  const projectOptions = [
    { v: "", label: t("所有项目"), icon: Folder },
    ...(groups ?? []).map((g) => ({ v: g.workspaceId ?? UNGROUPED, label: g.title, icon: Folder })),
  ];

  const archivedCount = visible.reduce((n, g) => n + g.rows.length, 0);
  // 「全部删除」交给页头渲染（原关闭叉的位置，用户定稿）：回调经 ref 固定身份，
  // 只在候选计数变化时上报，避免与父渲染互相触发。
  const deleteAllRef = useRef(deleteAll);
  deleteAllRef.current = deleteAll;
  const stableDeleteAll = useCallback(() => void deleteAllRef.current(), []);
  useEffect(() => {
    if (!onBulk) return;
    onBulk({ count: archivedCount, onDelete: stableDeleteAll });
    return () => onBulk(null);
  }, [onBulk, archivedCount, stableDeleteAll]);
  return (
    <div className={rowsCss.section}>
      <div className={rowsCss.archToolbar}>
        <div className={rowsCss.archSearch}>
          <Search size={14} className={rowsCss.archSearchIcon} />
          <input
            className={rowsCss.archSearchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("搜索已归档聊天")}
            aria-label={t("搜索已归档聊天")}
          />
        </div>
        <Dropdown options={projectOptions} value={project} onChange={setProject} />
      </div>
      {groups === null && <div className={rowsCss.muted}>{t("载入中…")}</div>}
      {groups !== null && groups.length === 0 && <div className={rowsCss.muted}>{t("暂无归档会话")}</div>}
      {groups !== null && groups.length > 0 && visible.length === 0 && (
        <div className={rowsCss.muted}>{t("无匹配会话")}</div>
      )}
      {visible.map((g) => (
        <section key={g.workspaceId ?? UNGROUPED}>
          <div className={rowsCss.archGroupHead}>
            <Folder size={15} className={rowsCss.archGroupIcon} />
            <span className={rowsCss.archGroupName}>{g.title}</span>
            <span className={rowsCss.archGroupCount}>
              {tt("{n} 个聊天", "{n} chats", { n: g.rows.length })}
            </span>
          </div>
          <div className={rowsCss.archCard}>
            {g.rows.map((r) => (
              <div key={r.sessionId} className={rowsCss.archRow}>
                <div className={rowsCss.archRowMain}>
                  <div className={rowsCss.archRowTitle}>{r.title}</div>
                  <div className={rowsCss.archRowTime}>{dateFmt.format(r.updatedAt)}</div>
                </div>
                <div className={rowsCss.archRowActions}>
                  <button
                    type="button"
                    className={rowsCss.archIconBtn}
                    data-tip={t("删除")}
                    aria-label={t("删除")}
                    onClick={() => void deleteOne(r.sessionId)}
                  >
                    <Trash2 size={15} />
                  </button>
                  <button
                    type="button"
                    className={rowsCss.archRestore}
                    onClick={() => restore(r.sessionId)}
                  >
                    <Undo2 size={13} />
                    {t("取消归档")}
                  </button>
                </div>

              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ───────────────────────── 数据 ───────────────────────── */

function DataSection() {
  const { t } = useT();
  const [home, setHome] = useState("");
  useEffect(() => {
    sendToShell({ type: "get-prefs" });
    return onHostEvent((cmd, payload) => {
      if (cmd === "prefs" && payload) setHome((payload as { home?: string }).home ?? "");
    });
  }, []);
  return (
    <div className={rowsCss.section}>
      <div className={rowsCss.sectionTitle}>{t("数据与存储")}</div>
      <div className={rowsCss.rowGroup}>
      <div className={rowsCss.rowCard}>
        <div className={rowsCss.rowIdentity}>
          <div className={rowsCss.rowName}>{t("存储位置（DSH_HOME）")}</div>
          <div className={rowsCss.rowCaption}>{home || t("加载中…")}</div>
        </div>
        <div className={rowsCss.rowActions}>
          <button className={rowsCss.secondaryButton} onClick={() => sendToShell({ type: "reveal-home" })}>{t("在访达中打开")}</button>
        </div>
      </div>
      <div className={rowsCss.rowCard}>
        <div className={rowsCss.rowIdentity}>
          <div className={rowsCss.rowName}>settings.yaml</div>
          <div className={rowsCss.rowCaption}>{t("引擎配置文档")}</div>
        </div>
        <div className={rowsCss.rowActions}>
          <button className={rowsCss.secondaryButton} onClick={() => sendToShell({ type: "open-host-doc" })}>{t("打开")}</button>
        </div>
      </div>
      </div>
    </div>
  );
}
