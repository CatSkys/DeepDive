// 插件页「技能」tab：`<DSH_HOME>/skills/<id>/SKILL.md` 的清单与新建、删除、从目录安装。
//
// 技能目录是**引擎的状态**，读写都走引擎（`api.skillsAdmin`，见 session-controller 的
// skill-catalog）：引擎自带 chokidar 发现，写完立刻生效、不用重启。壳只剩两件它才会做
// 的事——开选目录 sheet（`skillPickDirectory`）、报出随应用发布的那几个技能名
// （`appSkillNames`：壳每次启动把它们写回技能根，删了会回来，所以不给删除入口）。
// frontmatter 缺 name/description 的技能引擎会**静默忽略**，所以缺键的照样列出来并
// 标明缺什么。

import { useCallback, useEffect, useState } from "react";
import { FileCode2, Folder, FolderInput, Plus, Trash2 } from "lucide-react";
import { api, type SkillAdminEntry } from "../api";
import { alertDialog, confirmDialog } from "../components/DialogHost";
import { appSkillNames, inShell, revealPath, skillPickDirectory } from "../host";
import { useT } from "../i18n";
import rs from "../settings/SettingsRows.module.css";
import css from "./Plugins.module.css";

/** 引擎给的稳定错误码 → 该说的话（键即中文原文，英文在 i18n-en 里配对）。 */
const FAILURE_TEXT: Record<string, string> = {
  "skills-admin/invalid-name": "技能名不能为空、不能含斜杠，也不能以点开头",
  "skills-admin/exists": "同名技能已存在",
  "skills-admin/missing-manifest": "这个目录里没有 SKILL.md",
  "skills-admin/not-one-level": "只能删除技能根下的一层目录",
  "skills-admin/inside-root": "它已经在技能根里了",
  "skills-admin/unavailable": "读不到引擎的技能根（引擎没有受监督的 DSH_HOME）",
};

/** RPC 失败 → 展示文案：认得的码说人话，不认得的退回兜底句。 */
function failureText(error: unknown, fallback: string): string {
  const code = (error as { code?: string } | undefined)?.code;
  return (code !== undefined && FAILURE_TEXT[code]) || fallback;
}

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
  const [skills, setSkills] = useState<SkillAdminEntry[]>([]);
  const [published, setPublished] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [creating, setCreating] = useState(false);
  const shell = inShell();

  const refresh = useCallback(() => {
    void api.skillsAdmin.list()
      .then((r) => { setSkills(r.skills); setLoaded(true); })
      // 引擎未就绪、或这个引擎没有这组方法（技能面归自有引擎）：说清楚，不冒充"没有技能"
      .catch(() => { setUnavailable(true); setLoaded(true); });
  }, []);
  useEffect(refresh, [refresh]);

  useEffect(() => {
    void appSkillNames().then(setPublished);
  }, []);

  const create = async (name: string, description: string) => {
    try {
      await api.skillsAdmin.create(name, description);
    } catch (error: unknown) {
      await alertDialog({ message: failureText(error, t("创建失败")) });
      return;
    }
    setCreating(false);
    // 引擎 chokidar 发现有一拍延迟，稍等再拉
    window.setTimeout(refresh, 600);
  };

  const install = async () => {
    const picked = await skillPickDirectory();
    if (picked.cancelled || picked.path === undefined) return;
    try {
      await api.skillsAdmin.install(picked.path);
    } catch (error: unknown) {
      await alertDialog({ message: failureText(error, t("安装失败")) });
      return;
    }
    window.setTimeout(refresh, 600);
  };

  const removeSkill = async (skill: SkillAdminEntry) => {
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
    try {
      await api.skillsAdmin.remove(skill.id);
    } catch (error: unknown) {
      await alertDialog({ message: failureText(error, t("删除失败")) });
      return;
    }
    refresh();
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
        <button className={rs.secondaryButton} onClick={() => { void install(); }} disabled={!shell || unavailable}>
          <FolderInput size={12} /> {t("从目录安装")}
        </button>
        <button className={rs.secondaryButton} onClick={() => setCreating(true)} disabled={unavailable}>
          <Plus size={12} /> {t("新建")}
        </button>
      </div>
      <div className={rs.blockCard}>
        {unavailable && (
          <div className={rs.blockRow}>
            <span className={rs.muted}>{t("引擎未连接，或这个版本的引擎没有技能管理接口（技能面归自有引擎）。")}</span>
          </div>
        )}
        {!unavailable && loaded && skills.length === 0 && (
          <div className={rs.blockRow}>
            <span className={rs.muted}>{t("还没有自建技能。新建一个，或直接在技能根里放 <名字>/SKILL.md（字段：name、description）。")}</span>
          </div>
        )}
        {!unavailable && loaded && skills.length > 0 && visible.length === 0 && (
          <div className={rs.blockRow}>
            <span className={rs.muted}>{t("没有匹配的技能。")}</span>
          </div>
        )}
        {visible.map((skill) => {
          const managed = published.includes(skill.id);
          return (
            <div key={skill.id} className={rs.blockRow}>
              <FileCode2 size={13} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className={rs.rowName}>
                  {skill.title}
                  {managed && <span className={rs.presetBadge}>{t("随应用发布")}</span>}
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
                {!managed && (
                  <button className={rs.dangerButton} onClick={() => void removeSkill(skill)}>
                    <Trash2 size={12} /> {t("删除")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {creating && <SkillDialog onCancel={() => setCreating(false)} onSave={(n, d) => { void create(n, d); }} />}
    </>
  );
}
