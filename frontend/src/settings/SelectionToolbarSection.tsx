// 设置 → 选择文字工具栏（划词与截图两张卡）：开关、浮出方式、状态 HUD、排除的 App、
// 两处授权（辅助功能 / 屏幕录制）、截图快捷键。
// 只管这一屏的交互与渲染：设置形状与默认值在 ./selectionToolbar.ts，注册在壳侧
// HotKeyManager；这里发桥消息（selectionToolbarSet / set-pref / 授权请求）。

import { useEffect, useState } from "react";
import rowsCss from "./SettingsRows.module.css";
import { Dropdown, Toggle } from "../components/controls";
import {
  activationKeycap, MAX_EXCLUDED_APPS,
  type SelectionActivationMode, type SelectionToolbarSettings,
} from "./selectionToolbar";
import {
  builtinSelectionCommands, MAX_SELECTION_COMMANDS, type SelectionCommand,
} from "./selectionCommands";
import { SelectionCommandDialog } from "./SelectionCommandDialog";
import { uuid } from "../uuid";
import {
  onHostEvent, openAccessibilitySettings, permissionsState, requestScreenRecording, selectionAppsPick, sendToShell,
} from "../host";
import { useStore } from "../store";
import { useT } from "../i18n";

/** 浮出方式三档（值 → 文案键）。 */
const MODES: Array<{ v: SelectionActivationMode; zh: string; en: string }> = [
  { v: "hold", zh: "按住 ⌥ 选字", en: "While ⌥ is held" },
  { v: "always", zh: "任何选中都浮出", en: "On any selection" },
  { v: "toggle", zh: "监听模式（连按两次开合）", en: "Listening (press twice to toggle)" },
];

/** 一处系统授权的状态行：查得到状态就按状态显示——**已授权只显示状态，不摆按钮**
 *  （2026-10-13 用户定稿）；未授权才给"打开系统设置"。状态未知（还没查回来）时也
 *  给按钮，否则用户无处可去。 */
function PermissionRow({ name, hint, granted, onOpen, noteWhenGranted }: {
  name: string;
  hint: string;
  granted: boolean | null;
  onOpen: () => void;
  noteWhenGranted?: string;
}) {
  const { t } = useT();
  return (
    <div className={rowsCss.hotkeyRow}>
      <div className={rowsCss.rowIdentity}>
        <div className={rowsCss.rowName}>{name}</div>
        <div className={rowsCss.rowCaption}>
          {granted === true ? (noteWhenGranted ?? hint) : granted === false ? t("未授权。") : hint}
        </div>
      </div>
      <div className={rowsCss.rowActions}>
        {granted === true ? (
          <span className={`${rowsCss.comboChip} ${rowsCss.granted}`}>{t("已授权")}</span>
        ) : (
          <button type="button" className={rowsCss.comboChip} onClick={onOpen}>
            {t("打开系统设置")}
          </button>
        )}
      </div>
    </div>
  );
}

export function SelectionToolbarSection() {
  const { t, tt } = useT();
  const store = useStore();
  const settings = store.selectionToolbar;
  const setSettings = store.setSelectionToolbar;
  // 两处授权：进页面查一次当前值（壳的 `permissions-state`），其后靠推送更新。
  const [permissions, setPermissions] = useState<{ accessibility: boolean; screenRecording: boolean } | null>(null);
  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);

  useEffect(() => { void permissionsState().then(setPermissions); }, []);

  // 壳推来的授权与监听状态（打开设置页时先问一次当前值）。
  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd === "accessibilityTrust") {
      const trusted = (payload as { trusted?: boolean } | undefined)?.trusted === true;
      setPermissions((prev) => ({ accessibility: trusted, screenRecording: prev?.screenRecording ?? false }));
    }
    if (cmd === "screenRecordingTrust") {
      const trusted = (payload as { trusted?: boolean } | undefined)?.trusted === true;
      setPermissions((prev) => ({ accessibility: prev?.accessibility ?? false, screenRecording: trusted }));
    }
    if (cmd === "selectionListening") setListening((payload as { on?: boolean } | undefined)?.on === true);
    if (cmd === "hotkeyChanged" && (payload as { which?: string } | undefined)?.which === "screenshot") setRecording(false);
    if (cmd === "hotkeyRecordingEnded") setRecording(false);
  }), []);

  const patch = (next: Partial<SelectionToolbarSettings>) => setSettings({ ...settings, ...next });

  // 命令目录：一张弹窗管新增与编辑（`isNew` 只改标题），保存即整份写回（经壳持久化）。
  const commands = store.selectionCommands;
  const [editing, setEditing] = useState<{ command: SelectionCommand; isNew: boolean } | null>(null);
  const save = (next: SelectionCommand) => {
    const at = commands.findIndex((c) => c.id === next.id);
    store.setSelectionCommands(at === -1 ? [...commands, next] : commands.map((c) => (c.id === next.id ? next : c)));
  };
  const remove = (id: string) => store.setSelectionCommands(commands.filter((c) => c.id !== id));
  /** 把缺的内置命令补回来，同 id 的既有条目原样保留（编辑过的不被覆盖）。 */
  const restoreBuiltins = () => {
    const room = MAX_SELECTION_COMMANDS - commands.length;
    if (room <= 0) return;
    const have = new Set(commands.map((c) => c.id));
    const missing = builtinSelectionCommands().filter((c) => !have.has(c.id)).slice(0, room);
    if (missing.length > 0) store.setSelectionCommands([...commands, ...missing]);
  };

  const pickApps = () => {
    void selectionAppsPick().then((apps) => {
      if (apps.length === 0) return;
      const merged = [...settings.excludedBundleIds];
      for (const app of apps) if (!merged.includes(app.bundleId)) merged.push(app.bundleId);
      patch({ excludedBundleIds: merged.slice(0, MAX_EXCLUDED_APPS) });
    });
  };

  return (
    <>
      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("选择文字工具栏")}</div>
        <div className={rowsCss.sectionIntro}>
          {t("在任意应用里选中文字时，浮出一条小工具条：「问 DeepDive」把这段文字引用进输入框，后面的按钮直接跑命令。")}
        </div>
        <div className={rowsCss.hotkeyCard}>
          <div className={rowsCss.hotkeyRow}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("启用工具条")}</div>
              <div className={rowsCss.rowCaption}>{t("需要「辅助功能」权限才读得到选中的文字。")}</div>
            </div>
            <div className={rowsCss.rowActions}>
              <Toggle on={settings.enabled} onChange={(v) => patch({ enabled: v })} />
            </div>
          </div>

          <div className={rowsCss.hotkeyRow}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("浮出方式")}</div>
            </div>
            <div className={rowsCss.rowActions}>
              <Dropdown
                options={MODES.map((m) => ({ v: m.v, label: tt(m.zh, m.en) }))}
                value={settings.activation}
                onChange={(v) => patch({ activation: v as SelectionActivationMode })}
              />
            </div>
          </div>

          {settings.activation !== "always" && (
            <div className={rowsCss.hotkeyRow}>
              <div className={rowsCss.rowIdentity}>
                <div className={rowsCss.rowName}>{t("组合键")}</div>
                <div className={rowsCss.rowCaption}>
                  {settings.activation === "hold"
                    ? t("按住它选字才会浮出。")
                    : t("连按两次这个组合，开合「监听中」。")}
                </div>
              </div>
              <div className={rowsCss.rowActions}>
                <span className={rowsCss.comboChip}>{activationKeycap(settings.activationKeys)}</span>
              </div>
            </div>
          )}

          <div className={rowsCss.hotkeyRow}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("状态提示")}</div>
              <div className={rowsCss.rowCaption}>
                {settings.activation === "toggle"
                  ? t("监听开着时，屏幕下方显示一条状态胶囊。")
                  : t("仅监听模式下有意义。")}
              </div>
            </div>
            <div className={rowsCss.rowActions}>
              <Toggle on={settings.showHud} onChange={(v) => patch({ showHud: v })} />
            </div>
          </div>

          <div className={rowsCss.hotkeyRow}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>{t("这些应用里不显示")}</div>
              <div className={rowsCss.rowCaption}>
                {settings.excludedBundleIds.length === 0
                  ? t("还没有排除的应用。")
                  : tt("已排除 {n} 个应用", "{n} apps excluded", { n: String(settings.excludedBundleIds.length) })}
              </div>
            </div>
            <div className={rowsCss.rowActions}>
              <button type="button" className={rowsCss.comboChip} onClick={pickApps}>{t("选择应用…")}</button>
              {settings.excludedBundleIds.length > 0 && (
                <button
                  type="button"
                  className={rowsCss.comboChip}
                  onClick={() => patch({ excludedBundleIds: [] })}
                >
                  {t("全部清掉")}
                </button>
              )}
            </div>
          </div>

          <PermissionRow
            name={t("辅助功能权限")}
            hint={t("读取选中文字需要这项授权。")}
            granted={permissions?.accessibility ?? null}
            onOpen={openAccessibilitySettings}
          />

          {settings.activation === "toggle" && (
            <div className={rowsCss.hotkeyRow}>
              <div className={rowsCss.rowIdentity}>
                <div className={rowsCss.rowName}>{t("监听状态")}</div>
              </div>
              <div className={rowsCss.rowActions}>
                <button
                  type="button"
                  className={`${rowsCss.comboChip}${listening ? ` ${rowsCss.recording}` : ""}`}
                  onClick={() => sendToShell({ type: "selection-listening", on: !listening })}
                >
                  {listening ? t("监听中") : t("未监听")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("命令")}</div>
        <div className={rowsCss.sectionIntro}>
          {t("选中文字后胶囊上并排的按钮。点一条就把它的提示词连着你选中的文字发出去，答案在迷你面板的对话里。")}
        </div>
        <div className={rowsCss.hotkeyCard}>
          {commands.length === 0 && (
            <div className={rowsCss.hotkeyRow}>
              <div className={rowsCss.rowIdentity}>
                <div className={rowsCss.rowCaption}>{t("一条命令都没有——胶囊上只会剩「问 DeepDive」。")}</div>
              </div>
            </div>
          )}
          {commands.map((c) => (
            <div key={c.id} className={rowsCss.hotkeyRow}>
              <div className={rowsCss.rowIdentity}>
                <div className={rowsCss.rowName} style={!c.enabled ? { color: "var(--ink-3)" } : undefined}>
                  {c.name}
                </div>
                <div className={`${rowsCss.rowCaption} ${rowsCss.cmdSummary}`}>{c.prompt}</div>
              </div>
              <div className={rowsCss.rowActions}>
                <button type="button" className={rowsCss.comboChip} onClick={() => setEditing({ command: c, isNew: false })}>
                  {t("编辑")}
                </button>
                <Toggle on={c.enabled} onChange={(v) => save({ ...c, enabled: v })} />
              </div>
            </div>
          ))}
        </div>
        <div className={rowsCss.cmdTools}>
          <button
            type="button"
            className={rowsCss.secondaryButton}
            disabled={commands.length >= MAX_SELECTION_COMMANDS}
            onClick={() => setEditing({ command: { id: uuid(), name: "", prompt: "", enabled: true }, isNew: true })}
          >
            {t("添加命令…")}
          </button>
          <button type="button" className={rowsCss.secondaryButton} onClick={restoreBuiltins}>
            {t("恢复内置命令")}
          </button>
          {commands.length >= MAX_SELECTION_COMMANDS && (
            <span className={rowsCss.muted}>{tt("最多 {n} 条", "At most {n}", { n: String(MAX_SELECTION_COMMANDS) })}</span>
          )}
        </div>
      </div>

      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("截图")}</div>
        <div className={rowsCss.sectionIntro}>
          {t("全屏冻结后拖选或点选区域，随手用箭头、马赛克、序号标注；确认后图片进输入框，另附一份识别出的屏幕文字。")}
        </div>
        <div className={rowsCss.hotkeyCard}>
          <div className={rowsCss.hotkeyRow}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName} style={!store.screenshotHotkeyOn ? { color: "var(--ink-3)" } : undefined}>
                {t("截图快捷键")}
                <span className={rowsCss.metaTag}>{t("全局")}</span>
              </div>
            </div>
            <div className={rowsCss.rowActions}>
              <button
                type="button"
                className={`${rowsCss.comboChip}${recording ? ` ${rowsCss.recording}` : ""}${!store.screenshotHotkeyOn ? ` ${rowsCss.off}` : ""}`}
                onClick={() => { if (store.screenshotHotkeyOn && !recording) { setRecording(true); sendToShell({ type: "rebind-hotkey", which: "screenshot" }); } }}
                aria-label={t("修改快捷键")}
              >
                {recording ? t("录制中…") : store.screenshotHotkey}
              </button>
              <Toggle on={store.screenshotHotkeyOn} onChange={(v) => store.setScreenshotHotkeyOn(v)} />
            </div>
          </div>

          <PermissionRow
            name={t("屏幕录制权限")}
            hint={t("截图需要这项授权。")}
            granted={permissions?.screenRecording ?? null}
            onOpen={requestScreenRecording}
            noteWhenGranted={t("刚授权的请退出并重开本应用（macOS 只对重启后的应用生效）。")}
          />
        </div>
      </div>

      {editing && (
        <SelectionCommandDialog
          draft={editing.command}
          isNew={editing.isNew}
          onCancel={() => setEditing(null)}
          onSave={(next) => { save(next); setEditing(null); }}
          onDelete={editing.isNew ? null : () => { remove(editing.command.id); setEditing(null); }}
        />
      )}
    </>
  );
}
