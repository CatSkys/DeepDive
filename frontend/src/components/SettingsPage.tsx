import { useCallback, useEffect, useState } from "react";
import {
  Archive, ChevronLeft, Cpu, Folder, Keyboard, Moon,
  Monitor, Settings as SettingsIcon, ShieldAlert, ShieldCheck,
  SquarePen, Sun, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import rowsCss from "../settings/SettingsRows.module.css";
import { Dropdown, Toggle } from "../settings/controls";
import { ModelsManage } from "../settings/ModelsManage";
import { permissionPresetView, type PermissionSettingsView } from "../settings/permissionPreset";
import { api, probeMethod } from "../api";
import { onHostEvent, sendToShell } from "../host";
import { useStore } from "../store";
import { sessionTitle } from "../session/sessionTitle";
import { useT } from "../i18n";

// 设置页 —— 与主界面同一套设计体系：主界面语义变量 + 统一弹出配方 +
// 复用 Dropdown/Toggle 组件；不再使用官方 dsh settings 面板的独立
// token 体系（dsw-alias 已废除）。数据全部走真实路由，无引擎时各
// section 独立降级。
//
// 分类：通用（外观/语言/Enter 行为/通知）、模型（提供方+密钥）、
// 审批（默认权限预设）、Agent 预设、插件、快捷键、已归档的聊天、数据。

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [activeId, setActiveId] = useState("general");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const nav = [
    { id: "general", label: t("通用"), icon: SettingsIcon },
    { id: "models", label: t("模型"), icon: Cpu },
    { id: "approval", label: t("审批"), icon: ShieldCheck },
    { id: "hotkeys", label: t("快捷键"), icon: Keyboard },
    { id: "archived", label: t("已归档的聊天"), icon: Archive },
    { id: "data", label: t("数据"), icon: Folder },
  ];
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
        {nav.map((n) => (
          <button
            key={n.id}
            className={`snav-item${n.id === activeId ? " active" : ""}`}
            onClick={() => setActiveId(n.id)}
          >
            <n.icon size={15} />
            {n.label}
          </button>
        ))}
      </nav>
      <main className="main" aria-label={t("设置")}>
        <div className="settings-content">
          <div className="settings-head">
            <div className="settings-title">{active.label}</div>
            <button className="settings-close" onClick={onClose} aria-label={t("关闭")}>
              <X size={16} />
            </button>
          </div>
          {activeId === "general" && <GeneralSection />}
          {activeId === "models" && <ModelsManage />}
          {activeId === "approval" && <ApprovalSection />}
          {activeId === "hotkeys" && <HotkeysSection />}
          {activeId === "archived" && <ArchivedSection />}
          {activeId === "data" && <DataSection />}
        </div>
      </main>
    </>
  );
}

/* ───────────────────────── 通用 ───────────────────────── */

function GeneralSection() {
  const { t } = useT();
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

  useEffect(() => {
    void (async () => {
      try {
        const d = await api.settingsDescribe();
        const ns = (d.namespaces ?? []).find((n) => n.ns === "ui-conversation");
        const v = (ns?.value as { busyEnter?: string } | null)?.busyEnter;
        if (v) setBusy(v);
      } catch { /* engine booting */ }
    })();
  }, []);
  const saveBusy = async (v: string) => {
    setBusy(v);
    try {
      const d = await api.settingsDescribe();
      const ns = (d.namespaces ?? []).find((n) => n.ns === "ui-conversation");
      if (!ns) return;
      const base = (ns.value ?? {}) as Record<string, unknown>;
      await api.settingsUpdate({ ns: "ui-conversation", patch: { ...base, busyEnter: v }, expectedRevision: ns.revision });
    } catch (err) { alert(t("保存失败：{m}").replace("{m}", (err as Error).message)); }
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
      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("通知")}</div>
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
  const { t } = useT();
  // undefined=载入中，null=引擎未提供 permission 命名空间
  const [view, setView] = useState<PermissionSettingsView | null | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const d = await api.settingsDescribe();
      setView(permissionPresetView((d.namespaces ?? []).find((n) => n.ns === "permission")));
    } catch { /* engine booting: stay loading */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const setDefault = async (v: string) => {
    setView((cur) => (cur ? { ...cur, current: v } : cur));
    try {
      const d = await api.settingsDescribe();
      const ns = (d.namespaces ?? []).find((n) => n.ns === "permission");
      if (!ns) return;
      const base = (ns.value ?? {}) as Record<string, unknown>;
      await api.settingsUpdate({ ns: "permission", patch: { ...base, defaultPreset: v }, expectedRevision: ns.revision });
    } catch (err) { alert(t("保存失败：{m}").replace("{m}", (err as Error).message)); }
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
        <div className={rowsCss.rowCard}>
          <div className={rowsCss.rowIdentity}>
            <div className={rowsCss.rowName}>{t("默认权限预设")}</div>
            <div className={rowsCss.rowCaption}>{t("新建会话的初始权限。")}</div>
          </div>
          <div className={rowsCss.rowActions}>
            <Dropdown options={options} value={view.current} onChange={(v) => void setDefault(v)} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── 快捷键 ───────────────────────── */

function HotkeysSection() {
  const { t, tt } = useT();
  const [hotkey, setHotkey] = useState("⌥Space");
  const [recording, setRecording] = useState(false);
  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd === "hotkeyChanged" && payload) {
      setHotkey((payload as { spec?: string }).spec ?? hotkey);
      setRecording(false);
    }
  }), [hotkey]);
  // 只列真实存在的快捷键（AUD-005）：⌘, 是壳主菜单项；Esc/Enter/@///Tab
  // 在 Composer 与编辑态实现。⌘K/⌘T/⌘W/⌘1..9/⌘V 附件粘贴均未实现，禁止列出。
  const inApp: Array<[string, string]> = [
    ["⌘,", t("设置")], ["Esc", t("收起菜单 / 取消")], ["Enter", t("发送")], ["@", t("引用")], ["/", t("命令")], ["Tab", t("补全")],
  ];
  return (
    <>
      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("全局热键")}</div>
        <div className={rowsCss.sectionIntro}>{t("任意应用下生效。")}</div>
        <div className={rowsCss.rowCard}>
          <div className={rowsCss.rowIdentity}>
            <div className={rowsCss.rowName}>{t("唤起面板")}</div>
            <div className={rowsCss.rowCaption}>{recording ? t("按下新的组合键…") : tt("当前：{k}", "Current: {k}", { k: hotkey })}</div>
          </div>
          <div className={rowsCss.rowActions}>
            <button
              className={rowsCss.secondaryButton}
              style={recording ? { opacity: 0.6 } : undefined}
              onClick={() => { if (!recording) { setRecording(true); sendToShell({ type: "rebind-hotkey" }); } }}
            >
              {recording ? t("录制中…") : t("修改")}
            </button>
          </div>
        </div>
      </div>
      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("应用内快捷键")}</div>
        <div className={rowsCss.sectionIntro}>{t("固定映射，不可自定义。")}</div>
        {inApp.map(([key, desc]) => (
          <div key={key} className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{desc}</div>
            </div>
            <div className={rowsCss.rowActions}>
              <span className={rowsCss.mono}>{key}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ───────────────────────── 已归档的聊天 ───────────────────────── */

export function ArchivedSection() {
  const { t, lang } = useT();
  const [rows, setRows] = useState<Array<{ sessionId: string; title: string; updatedAt: number }> | null>(null);
  const [unarchiveSupported, setUnarchiveSupported] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [ws, ss, unarchive] = await Promise.all([
          api.workspaces(),
          api.sessions(),
          probeMethod("workspace.unarchiveSession"),
        ]);
        if (cancelled) return;
        setUnarchiveSupported(!!unarchive);
        const archived = new Set(ws.archivedSessionIds ?? []);
        setRows(
          (ss.items ?? [])
            .filter((s) => archived.has(s.sessionId))
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((s) => ({
              sessionId: s.sessionId,
              title: sessionTitle(s, lang),
              updatedAt: s.updatedAt,
            })),
        );
      } catch { if (!cancelled) setRows([]); }
    })();
    return () => { cancelled = true; };
    // t 经 useT 按 lang 缓存为稳定引用（i18n.ts tFuncCache），入表不会触发每渲染重跑
  }, [t, lang]);

  return (
    <div className={rowsCss.section}>
      <div className={rowsCss.sectionIntro}>
        {unarchiveSupported
          ? t("已归档的会话。可在此恢复到工作空间。")
          : t("已归档的会话（当前引擎版本不支持取消归档，仅可查看）。")}
      </div>
      {rows === null && <div className={rowsCss.muted}>{t("载入中…")}</div>}
      {rows !== null && rows.length === 0 && <div className={rowsCss.muted}>{t("暂无归档会话")}</div>}
      {rows !== null && rows.map((r) => (
        <div key={r.sessionId} className={rowsCss.rowCard}>
          <div className={rowsCss.rowIdentity}>
            <div className={rowsCss.rowName}>{r.title}</div>
            <div className={rowsCss.rowCaption}>{new Date(r.updatedAt).toLocaleString()}</div>
          </div>
        </div>
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
  );
}
