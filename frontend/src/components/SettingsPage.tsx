import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import {
  IconAgentPresetOutline16, IconAlarmClockOutline16, IconCheckOutline16,
  IconDarkOutline16, IconDatabaseOutline16, IconDataOutline16, IconEnhanceOutline16,
  IconSettingsOutline16,
} from "../settings/primitives/icons";
import { SettingsPanel, type SettingsSectionRow } from "../settings/SettingsPanel";
import rowsCss from "../settings/SettingsRows.module.css";
import "../settings/settings-tokens.css";
import { api, probeMethod, type SettingsNamespaceEntry } from "../api";
import { onHostEvent, sendToShell } from "../host";
import { Toggle, Row, Section, Dropdown } from "../settings/controls";
import { diffOps, setPath, type Json } from "../settings/jsonDiff";
import { ModelsSettingsPane } from "../settings/models/ModelsSettingsPane";

// Built-in settings (user decision 2026-08-31): reuses the official dsh
// settings panel shell + row/card/button styles (token-driven, so the panel
// wears the main window's dark glass via the injected --dsw-alias-* tokens).
// Data flows through the same-origin gateway; writes sit behind the revision
// fence with two-choice conflict recovery (SPEC-SETTINGS §3.4).

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [activeId, setActiveId] = useState("models");
  const rows: SettingsSectionRow[] = [
    { id: "models", label: "模型", icon: IconDataOutline16, content: <ModelsSection /> },
    { id: "presets", label: "预设", icon: IconAgentPresetOutline16, content: <PresetsSection /> },
    { id: "plugins", label: "插件", icon: IconEnhanceOutline16, content: <PluginsSection /> },
    { id: "approval", label: "审批", icon: IconCheckOutline16, content: <ApprovalSection /> },
    { id: "hotkeys", label: "快捷键", icon: IconSettingsOutline16, content: <HotkeysSection /> },
    { id: "appearance", label: "外观", icon: IconDarkOutline16, content: <AppearanceSection /> },
    { id: "notifications", label: "通知", icon: IconAlarmClockOutline16, content: <NotificationsSection /> },
    { id: "data", label: "数据", icon: IconDatabaseOutline16, content: <DataSection /> },
  ];
  return <SettingsPanel rows={rows} activeId={activeId} onSelect={setActiveId} onClose={onClose} />;
}

// ---------- shared settings data plumbing

function useNamespaces() {
  const [namespaces, setNamespaces] = useState<Record<string, SettingsNamespaceEntry>>({});
  const describe = useCallback(async () => {
    try {
      const d = await api.settingsDescribe();
      const map: Record<string, SettingsNamespaceEntry> = {};
      for (const ns of d.namespaces ?? []) map[ns.ns] = ns;
      setNamespaces(map);
    } catch { /* engine booting */ }
  }, []);
  useEffect(() => { void describe(); }, [describe]);
  return { namespaces, describe };
}

function useNamespaceSaver(namespaces: Record<string, SettingsNamespaceEntry>, describe: () => Promise<void>) {
  const [conflict, setConflict] = useState<{ ns: string; patch: unknown } | null>(null);
  const saveNs = useCallback(async (ns: string, nextValue: Json) => {
    const entry = namespaces[ns];
    if (!entry) return;
    const ops = diffOps((entry.value ?? null) as Json, nextValue);
    if (ops.length === 0) return;
    try {
      await api.settingsMutate({ ns, ops, expectedRevision: entry.revision });
      await describe();
    } catch (err) {
      if (String((err as Error).message).startsWith("settings/conflict")) {
        setConflict({ ns, patch: nextValue });
      } else {
        alert(`保存失败：${(err as Error).message}`);
      }
    }
  }, [namespaces, describe]);
  const savePath = useCallback(async (ns: string, path: string, value: Json) => {
    const entry = namespaces[ns];
    if (!entry) return;
    await saveNs(ns, setPath((entry.value ?? {}) as Json, path.split("."), value));
  }, [namespaces, saveNs]);
  const conflictDialog = conflict && (
    <Section title="冲突">
      <Row title="设置已在其他位置被修改" caption={`「${conflict.ns}」的版本已前进。载入最新版本，或基于最新版本重试你的修改？`}>
        <button className={rowsCss.secondaryButton} onClick={async () => {
          setConflict(null);
          await describe();
        }}>载入最新</button>
        <button className={rowsCss.primaryButton} onClick={async () => {
          const { ns, patch } = conflict;
          setConflict(null);
          try {
            const d = await api.settingsDescribe();
            const fresh = (d.namespaces ?? []).find((n) => n.ns === ns);
            if (fresh) await api.settingsUpdate({ ns, patch, expectedRevision: fresh.revision });
            await describe();
          } catch (err) {
            alert(`重试失败：${(err as Error).message}`);
          }
        }}>基于最新重试</button>
      </Row>
    </Section>
  );
  return { saveNs, savePath, conflictDialog };
}

// ---------- 模型(官方 ui-settings-models 全功能)

function ModelsSection() {
  return <ModelsSettingsPane />;
}

// ---------- 审批

function ApprovalSection() {
  const { namespaces, describe } = useNamespaces();
  const { savePath, conflictDialog } = useNamespaceSaver(namespaces, describe);
  const entry = namespaces["permission"];
  const current = (entry?.value as { defaultPreset?: string } | null)?.defaultPreset ?? "workspace-write";
  const options = [
    { v: "read-only", label: "read-only（只读）" },
    { v: "workspace-write", label: "workspace-write（默认）" },
    { v: "danger-full-access", label: "danger-full-access（完整访问）" },
  ];
  return (
    <>
      <Section title="默认权限预设" intro="新建会话的初始权限。">
        <Row title="默认预设">
          <Dropdown
            options={options}
            value={current}
            onChange={(v) => {
              if (v === "danger-full-access" && !confirm("启用完整访问？将不再逐步审批命令与文件写入。")) return;
              void savePath("permission", "defaultPreset", v);
            }}
          />
        </Row>
      </Section>
      <p className={rowsCss.intro}>完整访问（danger-full-access）需要逐次确认；当前会话权限由会话内原生审批弹窗分别管理。</p>
      {conflictDialog}
    </>
  );
}

// ---------- 快捷键

function HotkeysSection() {
  const [hotkey, setHotkey] = useState("⌥Space");
  const [recording, setRecording] = useState(false);
  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd === "hotkeyChanged" && payload) {
      setHotkey((payload as { spec?: string }).spec ?? hotkey);
      setRecording(false);
    }
  }), [hotkey]);
  const inApp: Array<[string, string]> = [
    ["⌘K", "命令"], ["⌘T", "轨迹"], ["⌘,", "设置"], ["Esc", "收起 / 打断 / 取消"],
    ["⌘W", "关窗"], ["⌘1..9", "切任务"], ["⌘V", "粘贴附件"], ["@", "引用"], ["/", "命令"], ["Tab", "补全"],
  ];
  return (
    <>
      <Section title="全局热键" intro="任意应用下生效。">
        <Row title="唤起面板" caption={recording ? "按下新的组合键…" : `当前：${hotkey}`}>
          <button
            className={rowsCss.secondaryButton}
            style={recording ? { opacity: 0.6 } : undefined}
            onClick={() => { if (!recording) { setRecording(true); sendToShell({ type: "rebind-hotkey" }); } }}
          >
            {recording ? "录制中…" : "修改"}
          </button>
        </Row>
      </Section>
      <Section title="应用内快捷键" intro="固定映射，不可自定义。">
        {inApp.map(([key, desc]) => (
          <Row key={key} title={desc}>
            <span className={rowsCss.rowName}>{key}</span>
          </Row>
        ))}
      </Section>
    </>
  );
}

// ---------- 外观

function AppearanceSection() {
  const { namespaces, describe } = useNamespaces();
  const { savePath, conflictDialog } = useNamespaceSaver(namespaces, describe);
  const [glassOn, setGlassOn] = useState(true);
  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd === "prefs" && payload) setGlassOn((payload as { glass?: boolean }).glass ?? true);
  }), []);
  const entry = namespaces["ui-theme"];
  const pref = (entry?.value as { preference?: string } | null)?.preference ?? "dark";
  return (
    <>
      <Section title="界面设置" intro="设置应用主题和外观表现。">
        <Row title="黑白玻璃（暗色）" caption="关闭后界面跟随系统外观">
          <Toggle on={glassOn} onChange={(v) => {
            setGlassOn(v);
            sendToShell({ type: "set-theme", enabled: v });
          }} />
        </Row>
        <Row title="引擎界面明暗" caption="写入引擎 ui-theme 偏好">
          <Dropdown
            options={[{ v: "dark", label: "暗" }, { v: "light", label: "明" }]}
            value={pref}
            onChange={(v) => void savePath("ui-theme", "preference", v)}
          />
        </Row>
        <Row title="繁忙时 Enter 键行为" caption="仅在智能体运行时生效;Cmd/Ctrl+Enter 使用另一行为">
          <BusyEnterDropdown savePath={savePath} />
        </Row>
      </Section>
      {conflictDialog}
    </>
  );
}

/** 繁忙时 Enter 键行为(引擎 ui-conversation.busyEnter):插话发送/排队。 */
function BusyEnterDropdown({ savePath }: { savePath: (ns: string, path: string, value: Json) => Promise<void> }) {
  const [busy, setBusy] = useState<{ v: string } | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const d = await api.settingsDescribe();
        const ns = (d.namespaces ?? []).find((n) => n.ns === "ui-conversation");
        const v = (ns?.value as { busyEnter?: string } | null)?.busyEnter;
        if (v) setBusy({ v });
      } catch { /* engine booting */ }
    })();
  }, []);
  return (
    <Dropdown
      options={[{ v: "steer", label: "插话发送" }, { v: "queue", label: "排队" }]}
      value={busy?.v ?? ""}
      onChange={(v) => {
        setBusy({ v });
        void (async () => {
          try {
            const d = await api.settingsDescribe();
            const ns = (d.namespaces ?? []).find((n) => n.ns === "ui-conversation");
            if (!ns) return;
            const base = (ns.value ?? {}) as { busyEnter?: string };
            await api.settingsUpdate({ ns: "ui-conversation", patch: { ...base, busyEnter: v }, expectedRevision: ns.revision });
          } catch (err) { alert(`保存失败：${(err as Error).message}`); }
        })();
      }}
    />
  );
}

// ---------- 通知

function NotificationsSection() {
  const [prefs, setPrefs] = useState({ notifyTurnEnd: true, notifyAttention: true, bubble: true });
  useEffect(() => {
    sendToShell({ type: "get-prefs" });
    return onHostEvent((cmd, payload) => {
      if (cmd === "prefs" && payload) {
        const p = payload as Partial<typeof prefs>;
        if (p.notifyTurnEnd !== undefined || p.notifyAttention !== undefined || p.bubble !== undefined) {
          setPrefs((cur) => ({ ...cur, ...p }));
        }
      }
    });
  }, []);
  const change = (key: "notifyTurnEnd" | "notifyAttention" | "bubble", value: boolean) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    sendToShell({ type: "set-pref", key, value });
  };
  return (
    <>
      <Section title="提醒">
        <Row title="回合完成提醒" caption="静默通知，不打扰">
          <Toggle on={prefs.notifyTurnEnd} onChange={(v) => change("notifyTurnEnd", v)} />
        </Row>
        <Row title="待审批 / 待提问提醒" caption="通知 + Dock 弹跳">
          <Toggle on={prefs.notifyAttention} onChange={(v) => change("notifyAttention", v)} />
        </Row>
        <Row title="悬浮球" caption="常驻置顶，单击回主窗">
          <Toggle on={prefs.bubble} onChange={(v) => change("bubble", v)} />
        </Row>
      </Section>
      <p className={rowsCss.intro}>菜单栏状态图标始终实时反映状态，不受以上开关影响。</p>
    </>
  );
}

// ---------- 数据

function DataSection() {
  const [sessions, setSessions] = useState<Array<{ sessionId: string; title: string }>>([]);
  const [deletable, setDeletable] = useState(false);
  const [deleteMethod, setDeleteMethod] = useState("session.delete");
  const [home, setHome] = useState("");
  const [nsList, setNsList] = useState<string[]>([]);
  const [editNs, setEditNs] = useState("agent-default-model");
  const [jsonEdit, setJsonEdit] = useState<{ ns: string; text: string; revision: unknown; err?: string } | null>(null);

  const openJsonEditor = async (ns: string) => {
    try {
      const d = await api.settingsDescribe();
      const entry = (d.namespaces ?? []).find((n) => n.ns === ns);
      if (!entry) { alert(`引擎未返回「${ns}」`); return; }
      setJsonEdit({ ns, text: JSON.stringify(entry.value ?? null, null, 2), revision: entry.revision, err: undefined });
    } catch (err) {
      alert(`读取失败：${(err as Error).message}`);
    }
  };

  const saveJson = async () => {
    if (!jsonEdit) return;
    let edited: Json;
    try { edited = JSON.parse(jsonEdit.text) as Json; } catch {
      setJsonEdit({ ...jsonEdit, err: "JSON 解析失败" }); return;
    }
    try {
      const d = await api.settingsDescribe();
      const entry = (d.namespaces ?? []).find((n) => n.ns === jsonEdit.ns);
      if (!entry) { setJsonEdit({ ...jsonEdit, err: "引擎未返回该命名空间" }); return; }
      const ops = diffOps((entry.value ?? null) as Json, edited);
      if (ops.length === 0) { setJsonEdit(null); return; }
      await api.settingsMutate({ ns: jsonEdit.ns, ops, expectedRevision: entry.revision });
      setJsonEdit(null);
    } catch (err) {
      const msg = String((err as Error).message);
      setJsonEdit({ ...jsonEdit, err: msg.startsWith("settings/conflict") ? "版本已前进——请取消后重新打开(将载入最新)" : `保存失败：${msg}` });
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const d = await api.settingsDescribe();
        setNsList((d.namespaces ?? []).map((n) => n.ns).sort());
      } catch { /* engine booting */ }
      try {
        const r = await api.sessions();
        setSessions((r.items ?? []).slice(0, 20).map((s) => ({
          sessionId: s.sessionId,
          title: (s.projections?.values as { title?: string } | undefined)?.title ?? `任务 ${s.sessionId.slice(0, 6)}`,
        })));
      } catch { /* engine booting */ }
      const del = await probeMethod("session.delete");
      const archive = del ? false : await probeMethod("session.archive");
      setDeletable(del || archive);
      setDeleteMethod(del ? "session.delete" : "session.archive");
    })();
    const off = onHostEvent((cmd, payload) => {
      if (cmd === "prefs" && payload) setHome((payload as { home?: string }).home ?? "");
    });
    sendToShell({ type: "get-prefs" });
    return off;
  }, []);

  return (
    <>
      <Section title="数据与存储">
        <Row title="存储位置（DSH_HOME）" caption={home || "加载中…"}>
          <button className={rowsCss.secondaryButton} onClick={() => sendToShell({ type: "reveal-home" })}>在访达中打开</button>
        </Row>
        <Row title="settings.yaml" caption="引擎配置文档">
          <button className={rowsCss.secondaryButton} onClick={() => sendToShell({ type: "open-host-doc" })}>打开</button>
        </Row>
      </Section>
      <Section title="高级（命名空间原始 JSON 编辑）" intro="diff 后只提交改到的路径；revision 围栏防串写。">
        <Row title="命名空间">
          <div className="set-inline">
            <select className={rowsCss.selectField} value={editNs} onChange={(e) => setEditNs(e.target.value)}>
              {nsList.map((ns) => <option key={ns} value={ns}>{ns}</option>)}
            </select>
            <button className={rowsCss.secondaryButton} onClick={() => void openJsonEditor(editNs)}>编辑 JSON…</button>
          </div>
        </Row>
      </Section>
      <Section title="会话管理" intro="删除需确认且不可撤销。">
        {!deletable && <Row title="—" caption="本引擎版本不支持会话删除" />}
        {deletable && sessions.map((s) => (
          <Row key={s.sessionId} title={s.title}>
            <button className={rowsCss.secondaryButton} onClick={async () => {
              if (!confirm(`删除会话？该操作不可撤销：${s.title}`)) return;
              try {
                await api.callRaw(deleteMethod, { sessionId: s.sessionId });
                setSessions((list) => list.filter((x) => x.sessionId !== s.sessionId));
              } catch (err) {
                alert(`删除失败：${(err as Error).message}`);
              }
            }}>删除</button>
          </Row>
        ))}
      </Section>
      {jsonEdit && (
        <div className={rowsCss.ddMenu} style={{ position: "fixed", inset: "8%", padding: 16, minWidth: 0, zIndex: 60 }}>
          <div className={rowsCss.rowName}>编辑 {jsonEdit.ns}（原始 JSON）</div>
          <textarea
            className={rowsCss.textField}
            style={{ width: "100%", height: "56vh", marginTop: 10, fontFamily: "var(--dsh-font-mono-family, monospace)", fontSize: 11.5 }}
            value={jsonEdit.text}
            onChange={(e) => setJsonEdit({ ...jsonEdit, text: e.target.value })}
          />
          {jsonEdit.err && <div className={rowsCss.rowCaption} style={{ color: "var(--dsw-alias-state-error-primary)", marginTop: 6 }}>{jsonEdit.err}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
            <button className={rowsCss.secondaryButton} onClick={() => setJsonEdit(null)}>取消</button>
            <button className={rowsCss.primaryButton} onClick={() => void saveJson()}>保存（diff → ops）</button>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- 预设 + 插件(共享官方 roster/inventory 数据源)

interface InventoryPreset {
  id: string;
  trust?: string;
  name?: string;
  description?: string;
  isDefault?: boolean;
  broken?: boolean;
  rows?: Array<{ entryId: string; moduleName: string; enabled: boolean }>;
}

/** Official roster + plugin inventory share one source: pluginInventory/list.
 *  (agentPreset/list has no browser HTTP face on alpha.2.) */
function useInventory() {
  const [presets, setPresets] = useState<InventoryPreset[]>([]);
  const [entries, setEntries] = useState<Array<{ entryId: string; moduleName: string; enabled: boolean; fiberPhase: string | null }> | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const reloadPresets = useCallback(async () => {
    try {
      const r = await api.callRaw<{ agentPresets?: InventoryPreset[] }>("pluginInventory/list", {});
      setPresets(r.agentPresets ?? []);
    } catch { /* keep */ }
  }, []);
  useEffect(() => {
    void (async () => {
      if (!(await probeMethod("pluginInventory/list"))) { setAvailable(false); return; }
      try {
        const r = await api.callRaw<{ entries?: Array<{ entryId: string; moduleName: string; enabled: boolean; fiberPhase: string | null }>; agentPresets?: InventoryPreset[] }>("pluginInventory/list", {});
        setEntries(r.entries ?? []);
        setPresets(r.agentPresets ?? []);
        setAvailable(true);
      } catch { setAvailable(false); }
    })();
  }, []);
  return { presets, entries, available, reloadPresets };
}

function PresetsSection() {
  const { namespaces, describe } = useNamespaces();
  const { presets, available, reloadPresets } = useInventory();
  const entry = namespaces["agent-presets"];
  const current = (entry?.value as { default?: string } | null)?.default
    ?? presets.find((p) => p.isDefault)?.id
    ?? "standard";
  return (
    <>
      <Section title="Agent 预设" intro="新建任务时可选的角色;当前默认已标记。">
        {available !== true && presets.length === 0 && <Row title="载入中…" />}
        {available === true && presets.length === 0 && <Row title="—" caption="本引擎未提供预设。" />}
        {presets.map((p) => (
          <Row key={p.id} title={p.name ?? p.id} caption={[p.description, p.trust ? `trust: ${p.trust}` : undefined].filter(Boolean).join(" · ")}>
            <div className="set-inline">
              {p.id === current || p.isDefault ? <span style={{ color: "var(--dsw-alias-label-secondary)", fontSize: 11.5 }}>默认</span> : null}
              <button className={rowsCss.secondaryButton} onClick={() => {
                if (!entry) return;
                const base = (entry.value ?? {}) as { default?: string };
                void (async () => {
                  try {
                    await api.settingsUpdate({ ns: "agent-presets", patch: { ...base, default: p.id }, expectedRevision: entry.revision });
                    await describe();
                    await reloadPresets();
                  } catch (err) { alert(`保存失败：${(err as Error).message}`); }
                })();
              }}>设为默认</button>
            </div>
          </Row>
        ))}
      </Section>
      <p className={rowsCss.intro}>预设的复制/删除依赖 agentPreset 端点的浏览器面(当前引擎未暴露,仅可切换默认)。</p>
    </>
  );
}

function PluginsSection() {
  const { entries, available } = useInventory();
  return (
    <Section title="插件" intro="本引擎装载的扩展模块。">
      {available === null || (available && entries === null) ? (
        <Row title="载入中…" />
      ) : !available || entries === null || entries.length === 0 ? (
        <Row title="—" caption="本引擎未提供插件清单。" />
      ) : (
        entries.map((e) => (
          <Row key={e.entryId} title={e.moduleName} caption={`${e.entryId}${e.fiberPhase ? ` · ${e.fiberPhase}` : ""}`}>
            <span style={{ color: e.enabled ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-tertiary)", fontSize: 11.5 }}>
              {e.enabled ? "已启用" : "已停用"}
            </span>
          </Row>
        ))
      )}
    </Section>
  );
}
