// 设置 → 快捷键：三档（全局唤起热键 / 应用快捷键可改键 / 固定键位展示）。
// 只管这一屏的交互与渲染：键位清单与"能不能绑"的判据在 ../keybinds.ts，全局热键的注册
// 在壳侧 HotKeyManager（这里只发 rebind-hotkey、收 hotkeyChanged / hotkeyRecordingEnded）。

import { useEffect, useState } from "react";
import rowsCss from "./SettingsRows.module.css";
import { Toggle } from "../components/controls";
import { bindRejection, comboFor, comboOf, FIXED_KEYBINDS, formatHotkeySpec, isOff, KEYBIND_DEFS } from "../keybinds";
import { onHostEvent, sendToShell } from "../host";
import { useStore } from "../store";
import { useT } from "../i18n";

export function HotkeysSection() {
  const { t, tt } = useT();
  const store = useStore();
  const { keybinds, setKeybinds, hotkey, setHotkey } = store;
  const [recording, setRecording] = useState(false);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  // 改键成功：壳推的是 spec，转成键帽串再进 store（不经转换会显示「option+space」）；
  // 取消/关窗壳也回一条，否则这枚钮一直停在「录制中…」。
  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd === "hotkeyChanged" && payload) {
      const spec = (payload as { spec?: string }).spec;
      if (spec) setHotkey(formatHotkeySpec(spec));
      setRecording(false);
    }
    if (cmd === "hotkeyRecordingEnded") setRecording(false);
  }), [setHotkey]);

  // 录制期捕获任意按键：Esc 取消；绑不上（裸键 / 被菜单或系统占用 / 与别项冲突）
  // 就拒绝并说明原因——判据在 keybinds.ts，与运行时的匹配规则同一份。
  useEffect(() => {
    if (!recordingId) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setRecordingId(null); setConflict(null); return; }
      const combo = comboOf(e);
      if (!combo) return;
      const reject = bindRejection(recordingId, combo, keybinds, hotkey);
      if (reject?.kind === "need-modifier") {
        setConflict(tt("这个组合没有修饰键（⌘ / ⌃ / ⌥），裸键在各处已有固定语义", "That combination has no ⌘ / ⌃ / ⌥ modifier; bare keys already mean something here"));
        return;
      }
      if (reject?.kind === "reserved") {
        setConflict(tt("这个组合被 macOS 或「菜单与系统」占用，绑了不会生效", "macOS or the app menu already owns that combination; it would never fire"));
        return;
      }
      if (reject?.kind === "taken" && reject.other) {
        const other = reject.other;
        setConflict(tt("与「{n}」冲突", "Conflicts with \"{n}\"", { n: tt(other.zh, other.en) }));
        return;
      }
      setConflict(null);
      setKeybinds({ ...keybinds, [recordingId]: { combo } });
      setRecordingId(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recordingId, keybinds, setKeybinds, hotkey, t, tt]);

  const toggleBind = (id: string) =>
    setKeybinds({ ...keybinds, [id]: { combo: comboFor(id, keybinds), off: !isOff(id, keybinds) } });

  return (
    <>
      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("全局唤起")}</div>
        <div className={rowsCss.sectionIntro}>{t("系统级热键，任何应用在前台都能唤起面板并聚焦输入框。")}</div>
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
        </div>
      </div>

      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("应用快捷键")}</div>
        <div className={rowsCss.sectionIntro}>{t("点组合即可改键；右侧开关停用该键位。")}</div>
        <div className={rowsCss.hotkeyCard}>
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

      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("固定键位")}</div>
        <div className={rowsCss.sectionIntro}>{t("不可改键：各交互面内的按键、浏览器页面的键位，以及 macOS 菜单与系统接管的组合。")}</div>
        <div className={rowsCss.hotkeyCard}>
          {FIXED_KEYBINDS.map((group) => (
            <div key={group.zh}>
              <div className={rowsCss.hotkeyRow}>
                <div className={rowsCss.rowIdentity}>
                  <div className={rowsCss.rowCaption}>{tt(group.zh, group.en)}</div>
                </div>
              </div>
              {group.items.map((item) => (
                <div key={`${group.zh}:${item.keys}:${item.zh}`} className={rowsCss.hotkeyRow}>
                  <div className={rowsCss.rowIdentity}>
                    <div className={rowsCss.rowName}>{tt(item.zh, item.en)}</div>
                  </div>
                  <div className={rowsCss.rowActions}>
                    <span className={rowsCss.comboChip}>{item.keys}</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
