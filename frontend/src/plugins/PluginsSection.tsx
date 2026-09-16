// 技能与插件（设置页分区）：口径都写在这儿。
//
// · 插件：引擎 `pluginInventory/list` 是**只读投影**（官方 README 明写不能改动插件），
//   没有任何运行时启停 RPC。这个页面因此不做开关——实测证据在 `plugins/model.ts` 头部：
//   Loader 层 27 行 `enabled:false` 是「本层没挂载」而不是「用户关掉了」（工具类插件挂在
//   agent preset 组合里，`standard` 预设的 `tool-bash` 才是 active），给它们加开关只会
//   给出"无效或危险"的二选一。页面改为把两层清单都摊开：模型实际用到的那些工具在
//   「Agent 预设」卡片里，能找到状态的真相。
// · 技能：`<DSH_HOME>/skills/<id>/SKILL.md` 的普通文件（引擎按 rank 400 发现 + chokidar
//   热生效），清单与删除由壳读盘/删盘。frontmatter 缺 name/description 的技能引擎会
//   **静默忽略**，所以缺键的技能照样列出来并标明缺什么。
// 没有壳桥（手机浏览器打开 SPA）时技能卡显式说不可用，不冒充"空列表"。

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, FileCode2, Folder, Puzzle, Trash2 } from "lucide-react";
import { api, type PluginInventoryEntry, type PluginPreset } from "../api";
import { confirmDialog } from "../components/DialogHost";
import { inShell, revealPath, skillList, skillRemove, type SkillFile } from "../host";
import { useT } from "../i18n";
import css from "../settings/SettingsRows.module.css";
import { pluginState, presetRowLike, sortPluginRows, summarizePluginRows, type PluginState } from "./model";

const STATE_KEY: Record<PluginState, string> = {
  active: "已启用",
  failed: "启动失败",
  starting: "启动中",
  idle: "未运行",
  off: "本层未挂载",
  conditional: "按条件启用",
};

/** 状态徽章：颜色只分三档（活跃/失败/其它），文字才是信息。 */
function StateBadge({ state }: { state: PluginState }) {
  const { t } = useT();
  const on = state === "active";
  return (
    <span className={css.badge}>
      <span className={`${css.badgeDot}${on ? " on" : ""}`} />
      <span className={`${css.badgeText}${on ? " on" : ""}`}>{t(STATE_KEY[state])}</span>
    </span>
  );
}

export function PluginsSection() {
  const { t, tt } = useT();
  const [entries, setEntries] = useState<PluginInventoryEntry[] | null>(null);
  const [presets, setPresets] = useState<PluginPreset[]>([]);
  const [pluginError, setPluginError] = useState(false);
  const [openPreset, setOpenPreset] = useState<string | null>(null);
  const [showUnmounted, setShowUnmounted] = useState(false);
  const [skills, setSkills] = useState<SkillFile[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const shell = inShell();

  useEffect(() => {
    api.pluginInventory()
      .then((snapshot) => {
        setEntries(snapshot.entries);
        setPresets(snapshot.agentPresets ?? []);
        setPluginError(false);
      })
      .catch(() => { setEntries([]); setPluginError(true); });
  }, []);

  const refreshSkills = useCallback(() => {
    void skillList().then((rows) => { setSkills(rows); setSkillsLoaded(true); });
  }, []);
  useEffect(refreshSkills, [refreshSkills]);

  const mounted = (entries ?? []).filter((e) => e.enabled);
  const unmounted = (entries ?? []).filter((e) => !e.enabled);
  const summary = summarizePluginRows(entries ?? []);
  const visible = showUnmounted ? sortPluginRows(entries ?? []) : sortPluginRows(mounted);

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
    if (result.ok) refreshSkills();
  };

  return (
    <div className={css.section}>
      <div className={css.sectionTitle}>{t("技能与插件")}</div>
      <div className={css.sectionIntro}>
        {t("技能是技能根里的 SKILL.md 文件，由模型按需加载；插件是引擎装配的模块。引擎没有运行时启停插件的接口，这一面只读——改插件配置要动引擎的 profile 补丁并重启。")}
      </div>

      {pluginError && (
        <div className={css.blockCard}>
          <div className={css.blockRow}>
            <span className={css.muted}>{t("引擎未连接，或这个版本的引擎没有插件清单接口。")}</span>
          </div>
        </div>
      )}

      {!pluginError && presets.length > 0 && (
        <div className={css.blockCard}>
          <div className={css.blockHead}>
            <div className={css.blockTitle}>{t("Agent 预设与工具")}</div>
            <div className={css.blockDesc}>
              {t("模型实际用到的工具与插件按预设组合挂载——找某个工具开没开，看这里而不是下面的部署层。点一行展开它的成员。")}
            </div>
          </div>
          {presets.map((preset) => {
            const open = openPreset === preset.id;
            const rows = sortPluginRows(preset.rows.map(presetRowLike));
            const presetSummary = summarizePluginRows(rows);
            return (
              <div key={preset.id}>
                <button className={css.blockRow} aria-expanded={open} onClick={() => setOpenPreset(open ? null : preset.id)}>
                  <ChevronDown size={13} style={{ transform: open ? "none" : "rotate(-90deg)" }} />
                  <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                    <div className={css.rowName}>
                      {preset.name ?? preset.id}
                      {preset.isDefault && <span className={css.presetBadge}>{t("默认")}</span>}
                    </div>
                    <div className={css.rowCaption}>
                      {preset.broken
                        ? tt("这个预设的组合读不出来：{why}", "This preset's composition cannot be read: {why}", { why: preset.broken })
                        : tt("{n} 个成员 · 活跃 {a}", "{n} members · {a} active", { n: String(presetSummary.total), a: String(presetSummary.active) })}
                    </div>
                  </div>
                </button>
                {open && rows.map((row) => (
                  <div key={`${row.moduleName}:${row.entryId ?? ""}`} className={css.blockRow} style={{ paddingLeft: 32 }}>
                    <span className={css.mono}>{row.moduleName}</span>
                    <span style={{ marginLeft: "auto" }}>
                      <StateBadge state={pluginState(row)} />
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {!pluginError && <div className={css.blockCard}>
        <div className={css.blockHead}>
          <div className={css.blockTitle}>
            {entries === null
              ? t("部署层模块")
              : tt("部署层模块（{total} 个 · 已挂载 {mounted} · 失败 {failed}）", "Deployment modules ({total} · {mounted} mounted · {failed} failed)", {
                total: String(summary.total), mounted: String(mounted.length), failed: String(summary.failed),
              })}
          </div>
          <div className={css.blockDesc}>
            {t("引擎装配进本进程的模块清单（只读）。本层未挂载的多是工具类插件——它们按上面的预设挂载，所以在这里显示未挂载是正常的。")}
          </div>
        </div>

        {entries !== null && visible.map((entry) => (
          <div key={entry.entryId} className={css.blockRow}>
            <Puzzle size={13} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className={css.rowName}>{entry.moduleName}</div>
              <div className={css.mono}>{entry.entryId}</div>
            </div>
            <StateBadge state={pluginState(entry)} />
          </div>
        ))}

        {unmounted.length > 0 && (
          <div className={css.blockRow}>
            <span className={css.muted}>
              {showUnmounted
                ? t("已展开全部模块。")
                : tt("另有 {n} 个模块在本层未挂载。", "{n} more modules are not mounted at this level.", { n: String(unmounted.length) })}
            </span>
            <span style={{ marginLeft: "auto" }} />
            <button className={css.secondaryButton} onClick={() => setShowUnmounted((v) => !v)}>
              {showUnmounted ? t("只看已挂载") : t("展开全部")}
            </button>
          </div>
        )}
      </div>}

      <div className={css.blockCard}>
        <div className={css.blockHead}>
          <div className={css.blockTitle}>
            {skillsLoaded ? tt("技能（{n}）", "Skills ({n})", { n: String(skills.length) }) : tt("技能", "Skills")}
          </div>
          <div className={css.blockDesc}>
            {t("技能放在技能根 <DSH_HOME>/skills/<名字>/SKILL.md，引擎实时发现，改完即刻生效。frontmatter 缺 name 或 description 的技能会被引擎忽略。")}
          </div>
        </div>

        {!shell && (
          <div className={css.blockRow}>
            <span className={css.muted}>{t("技能在本机文件系统里，只有桌面应用能读写——当前是浏览器访问，看不到清单。")}</span>
          </div>
        )}
        {shell && skillsLoaded && skills.length === 0 && (
          <div className={css.blockRow}>
            <span className={css.muted}>{t("还没有自建技能。新建 <技能根>/<名字>/SKILL.md 即可（字段：name、description）。")}</span>
          </div>
        )}
        {shell && skills.map((skill) => (
          <div key={skill.id} className={css.blockRow}>
            <FileCode2 size={13} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className={css.rowName}>
                {skill.title}
                {skill.managed && <span className={css.presetBadge}>{t("随应用发布")}</span>}
              </div>
              <div className={css.rowCaption}>
                {skill.missing.length > 0
                  ? tt("缺 frontmatter 字段：{keys} —— 引擎会忽略这个技能", "Missing frontmatter keys: {keys} — the engine ignores this skill", { keys: skill.missing.join("、") })
                  : skill.detail || skill.id}
              </div>
            </div>
            <div className={css.rowActions}>
              <button className={css.secondaryButton} onClick={() => revealPath(skill.manifest)}>
                <Folder size={12} /> {t("在 Finder 中显示")}
              </button>
              {!skill.managed && (
                <button className={css.dangerButton} onClick={() => void removeSkill(skill)}>
                  <Trash2 size={12} /> {t("删除")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
