// 插件页「技能」tab：`<DSH_HOME>/skills/<id>/SKILL.md` 的清单与新建、删除。
//
// 技能由引擎按 rank 400 发现 + chokidar 热生效，但 wire 上**没有任何 skill 方法**，
// 所以清单、新建、删除都走壳（SkillAdmin）。frontmatter 缺 name/description 的技能
// 引擎会**静默忽略**，所以缺键的照样列出来并标明缺什么。
// 没有壳桥（手机浏览器打开 SPA）时显式说不可用，不冒充"空列表"。

import { useCallback, useEffect, useState } from "react";
import { FileCode2, Folder, FolderInput, Plus, Trash2 } from "lucide-react";
import { alertDialog, confirmDialog } from "../components/DialogHost";
import { inShell, revealPath, skillCreate, skillInstall, skillList, skillRemove, type SkillFile } from "../host";
import { useT } from "../i18n";
import rs from "../settings/SettingsRows.module.css";
import css from "./Plugins.module.css";

/** 新建弹窗：名字即目录名，也是模型侧 `/<name>` 的调用名。 */
function SkillDialog({ onCancel, onSave }: {
  onCancel: () => void;
  onSave: (name: string, description: string) => void;
}) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <div className="dialog-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dialog-card" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
        <div className="dialog-title">{t("新建技能")}</div>
        <div className={css.form}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t("名字（也是目录名与 /调用名）")}</span>
            <input className="dialog-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t("描述（模型据此决定何时加载）")}</span>
            <input className="dialog-input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>
        <div className="dialog-actions">
          <button type="button" className="dialog-btn" onClick={onCancel}>{t("取消")}</button>
          <button type="button" className="dialog-btn primary" onClick={() => onSave(name, description)}>{t("创建")}</button>
        </div>
      </div>
    </div>
  );
}

export function SkillsTab({ query }: { query: string }) {
  const { t, tt } = useT();
  const [skills, setSkills] = useState<SkillFile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const shell = inShell();

  const refresh = useCallback(() => {
    void skillList().then((rows) => { setSkills(rows); setLoaded(true); });
  }, []);
  useEffect(refresh, [refresh]);

  const create = async (name: string, description: string) => {
    const result = await skillCreate(name, description);
    if (!result.ok) {
      await alertDialog({ message: result.error ?? t("创建失败") });
      return;
    }
    setCreating(false);
    // 引擎 chokidar 发现有一拍延迟，稍等再拉
    window.setTimeout(refresh, 600);
  };

  const install = async () => {
    const result = await skillInstall();
    if (result.cancelled) return;
    if (!result.ok) {
      await alertDialog({ message: result.error ?? t("安装失败") });
      return;
    }
    window.setTimeout(refresh, 600);
  };

  const removeSkill = async (skill: SkillFile) => {
    const ok = await confirmDialog({
      message: tt(
        "删除技能「{name}」？会删掉目录 {dir}（含 SKILL.md），不可恢复。",
        "Delete the skill “{name}”? This removes the directory {dir} (with its SKILL.md) and cannot be undone.",
        { name: skill.title, dir: skill.directory },
      ),
      confirmLabel: t("删除"),
      cancelLabel: t("取消"),
    });
    if (!ok) return;
    const result = await skillRemove(skill.directory);
    if (result.ok) refresh();
  };

  const needle = query.trim().toLocaleLowerCase();
  const visible = needle.length === 0
    ? skills
    : skills.filter((s) => `${s.title}\n${s.id}\n${s.detail}`.toLocaleLowerCase().includes(needle));

  return (
    <>
      <div className={css.groupHead}>
        <div className={css.groupLabel}>
          {loaded ? tt("已安装（{n}）", "Installed ({n})", { n: String(skills.length) }) : t("已安装")}
        </div>
        <button className={rs.secondaryButton} onClick={() => { void install(); }} disabled={!shell}>
          <FolderInput size={12} /> {t("从目录安装")}
        </button>
        <button className={rs.secondaryButton} onClick={() => setCreating(true)} disabled={!shell}>
          <Plus size={12} /> {t("新建")}
        </button>
      </div>
      <div className={rs.blockCard}>
        {!shell && (
          <div className={rs.blockRow}>
            <span className={rs.muted}>{t("技能在本机文件系统里，只有桌面应用能读写——当前是浏览器访问，看不到清单。")}</span>
          </div>
        )}
        {shell && loaded && skills.length === 0 && (
          <div className={rs.blockRow}>
            <span className={rs.muted}>{t("还没有自建技能。新建一个，或直接在技能根里放 <名字>/SKILL.md（字段：name、description）。")}</span>
          </div>
        )}
        {shell && loaded && skills.length > 0 && visible.length === 0 && (
          <div className={rs.blockRow}>
            <span className={rs.muted}>{t("没有匹配的技能。")}</span>
          </div>
        )}
        {shell && visible.map((skill) => (
          <div key={skill.id} className={rs.blockRow}>
            <FileCode2 size={13} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className={rs.rowName}>
                {skill.title}
                {skill.managed && <span className={rs.presetBadge}>{t("随应用发布")}</span>}
              </div>
              <div className={rs.rowCaption}>
                {skill.missing.length > 0
                  ? tt("缺 frontmatter 字段：{keys} —— 引擎会忽略这个技能", "Missing frontmatter keys: {keys} — the engine ignores this skill", { keys: skill.missing.join("、") })
                  : skill.detail || skill.id}
              </div>
            </div>
            <div className={rs.rowActions}>
              <button className={rs.secondaryButton} onClick={() => revealPath(skill.manifest)}>
                <Folder size={12} /> {t("在 Finder 中显示")}
              </button>
              {!skill.managed && (
                <button className={rs.dangerButton} onClick={() => void removeSkill(skill)}>
                  <Trash2 size={12} /> {t("删除")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {creating && <SkillDialog onCancel={() => setCreating(false)} onSave={(n, d) => { void create(n, d); }} />}
    </>
  );
}
