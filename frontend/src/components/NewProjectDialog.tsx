// 新建项目表单弹窗（版式照参考图 Create Project）：名称（必填，行尾内嵌
// 图标触发钮）→ 目录（可选）→ 项目指令（可选 textarea）。OpenHost 挂 App
// 根部，任何入口经 openNewProjectDialog() 打开。
//
// 字段落点（引擎契约实证）：
//   · 目录：workspace/create 只收 path 且要求目录已存在（引擎 workspace 包
//     realpath+stat 校验），所以「留空自动建目录」由壳 prepare-workspace
//     完成（~/Documents/DeepDive Projects/<净化名>，撞名追加序号）；浏览器
//     （无壳桥）建不了目录——降级为手输绝对路径；指令可填，提交时明确报错
//     （写 AGENTS.md 只能壳做），不静默丢弃。
//   · 名称：wire 不收 title，创建后按 workspace/rename 落（自动目录的末级
//     目录名与名称一致时跳过）。
//   · 指令：壳写入 <项目>/AGENTS.md（引擎按 cwd 读它）；已存在不改动。
//   · 图标：纯前端装饰层，按 workspaceId 存 localStorage（wsIcons.ts）。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, Info, Plus } from "lucide-react";
import { api } from "../api";
import { inShell, prepareWorkspace } from "../host";
import { useStore } from "../store";
import { setWsIcon } from "../wsIcons";
import { useT } from "../i18n";
import { permissionPresetView, type PermissionSettingsView } from "../settings/permissionPreset";
import { useSettingNamespace } from "../settings/useSettingNamespace";
import { PRESET_META } from "./SettingsPage";
import { alertDialog, promptDialog } from "./DialogHost";
import { Dropdown, Toggle } from "./controls";
import { IconPicker } from "./IconPicker";
import { beginWorkspacePick, endWorkspacePick, setWorkspacePickSink } from "./workspacePicker";
import rowsCss from "../settings/SettingsRows.module.css";
import css from "./NewProjectDialog.module.css";

let openReq: (() => void) | null = null;

/** ＋新建项目的唯一入口（侧栏 / Hero 项目菜单共用）。 */
export function openNewProjectDialog(): void {
  openReq?.();
}

/** App 根部挂一次：消费 openNewProjectDialog 请求。 */
export function NewProjectDialogHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    openReq = () => setOpen(true);
    return () => { openReq = null; };
  }, []);
  return open ? <NewProjectDialog onClose={() => setOpen(false)} /> : null;
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const { t, tt } = useT();
  const store = useStore();
  const hasShell = inShell();

  const [name, setName] = useState("");
  const [glyph, setGlyph] = useState<string | null>(null);
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const [typedPath, setTypedPath] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 审批模式：与设置页「审批」同一数据源（permission.defaultPreset，新会话
  // 的初始权限预设）。undefined=载入中，null=引擎未提供该命名空间（隐藏行）。
  const [perm, setPerm] = useState<PermissionSettingsView | null | undefined>(undefined);
  const { describe: describePerm, update: updatePerm } = useSettingNamespace("permission");
  useEffect(() => {
    let alive = true;
    describePerm()
      .then((ns) => { if (alive) setPerm(permissionPresetView(ns)); })
      .catch(() => { if (alive) setPerm(null); });
    return () => { alive = false; };
  }, [describePerm]);

  const setApproval = async (v: string) => {
    setPerm((cur) => (cur ? { ...cur, current: v } : cur));
    try {
      await updatePerm({ defaultPreset: v });
    } catch (err) {
      void alertDialog({ message: tt("保存失败：{m}", "Save failed: {m}", { m: (err as Error).message }) });
    }
    describePerm()
      .then((ns) => setPerm(permissionPresetView(ns)))
      .catch(() => { /* 引擎重启窗口期：保留乐观值 */ });
  };

  // 目录选择器结果路由进本弹窗（workspacePicker 模块级 sink），卸载即清。
  // 只登记不触发——调起系统面板是工作区文件夹按钮自己的事。
  useEffect(() => {
    setWorkspacePickSink((path) => setPickedPath(path));
    return () => endWorkspacePick();
  }, []);

  const canSubmit = !!name.trim() && (hasShell || !!typedPath.trim()) && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    const trimmed = name.trim();
    setError(null);
    setBusy(true);
    try {
      // 浏览器没有壳桥写不了 AGENTS.md：明确报错，不静默丢弃
      if (!hasShell && instructions.trim()) {
        setError(t("写入项目指令需要桌面应用。"));
        return;
      }
      let target = typedPath.trim();
      if (hasShell) {
        // 壳负责：自动建目录（未显式选时）+ 写项目指令（AGENTS.md 不存在时）
        const prep = await prepareWorkspace({
          name: trimmed,
          ...(pickedPath ? { path: pickedPath } : {}),
          ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        });
        if (prep.error || !prep.path) {
          setError(prep.error ?? tt("创建项目失败：壳未响应。", "Create project failed: the shell did not respond."));
          setBusy(false);
          return;
        }
        target = prep.path;
      }
      const res = await store.createWorkspace(target);
      if (res.error || !res.workspaceId) {
        setError(tt("创建项目失败：{m}", "Create project failed: {m}", { m: res.error ?? "unknown" }));
        setBusy(false);
        return;
      }
      if (glyph) setWsIcon(res.workspaceId, glyph);
      // 名称与目录末级名不同才 rename（一致时引擎默认标题已经是它）
      const base = target.split("/").filter(Boolean).pop() ?? "";
      if (base !== trimmed) {
        try {
          await api.workspaceRename({ workspaceId: res.workspaceId, title: trimmed });
          await store.refresh();
        } catch { /* 引擎可能对重名标题做去重改名，落库失败不挡创建 */ }
      }
      onClose();
    } catch (err) {
      setError(tt("创建项目失败：{m}", "Create project failed: {m}", { m: (err as Error).message }));
      setBusy(false);
    }
  };

  return createPortal(
    // 关闭只认"按下 overlay 自身"；图标选择器的 portal 点击沿 React 树冒泡
    // 会路过这里，onClick+stopPropagation 拦截会误关（PITFALLS §1.7）。
    <div
      className={rowsCss.modalOverlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-label={t("新建项目")}
    >
      {/* Escape/⌘↵ 挂卡片上（不挂 document）：图标菜单 portal 后仍在本弹窗
          React 子树里，其内部 Escape 已被菜单 stopPropagation 截住，不会
          连带关掉整个弹窗 */}
      <div
        className={rowsCss.modal}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
        }}
      >
        <div className={rowsCss.modalHead}>
          <span className={rowsCss.modalTitle}>{t("新建项目")}</span>
        </div>
        <div className={rowsCss.modalBody}>
          <div className={rowsCss.rowGroup}>
            <div className={rowsCss.rowCard}>
              <span className={css.groupLabel}>{t("名称")}</span>
              <div className={css.groupControl}>
                <div className={css.nameField}>
                  <input
                    autoFocus
                    className={css.nameInput}
                    placeholder={t("项目名称")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <IconPicker value={glyph} onChange={setGlyph} />
                </div>
              </div>
            </div>
            <div className={rowsCss.rowCard}>
              <span className={css.groupLabel}>{t("记忆")}</span>
              <div className={`${css.groupControl} ${css.rowRight}`}>
                <span className={css.infoIcon} data-tip={t("每个会话维护一份笔记，每轮注入给模型；开关在应用下次启动后对会话生效。")}>
                  <Info size={14} />
                </span>
                <Toggle on={store.sessionMemoryEnabled} onChange={store.setSessionMemoryEnabled} />
              </div>
            </div>
            <div className={rowsCss.rowCard}>
              <span className={css.groupLabel}>{t("自进化")}</span>
              <div className={`${css.groupControl} ${css.rowRight}`}>
                <span className={css.infoIcon} data-tip={t("从会话中提炼可复用的经验，经机械校验后自动落库并提交；开关对采集与自动化即时生效。")}>
                  <Info size={14} />
                </span>
                <Toggle on={store.evolutionEnabled} onChange={store.setEvolutionEnabled} />
              </div>
            </div>
            {perm && (
              <div className={rowsCss.rowCard}>
                <span className={css.groupLabel}>{t("审批模式")}</span>
                <div className={`${css.groupControl} ${css.rowRight}`}>
                  <Dropdown
                    options={perm.options.map((o) => {
                      const meta = PRESET_META[o.value];
                      return {
                        v: o.value,
                        label: meta ? t(meta.label) : o.label,
                        description: meta ? t(meta.desc) : undefined,
                        icon: meta?.icon,
                        danger: meta?.danger,
                      };
                    })}
                    value={perm.current}
                    onChange={(v) => void setApproval(v)}
                  />
                </div>
              </div>
            )}
            <div className={rowsCss.rowCard}>
              <span className={css.groupLabel}>{t("工作区文件夹")}</span>
              <div className={css.groupControl}>
                <button
                  type="button"
                  data-tip={hasShell ? t("留空则按名称自动创建。") : undefined}
                  className={`${css.dirBtn}${pickedPath || typedPath ? ` ${css.filled}` : ""}`}
                  onClick={() => {
                    if (hasShell) beginWorkspacePick((path) => setPickedPath(path));
                    else {
                      // 浏览器降级：无壳桥建不了目录，弹输入框手输绝对路径
                      void promptDialog({
                        title: t("输入要添加为工作空间的文件夹绝对路径："),
                        initialValue: typedPath,
                      }).then((p) => { if (p && p.trim()) setTypedPath(p.trim()); });
                    }
                  }}
                >
                  {pickedPath || typedPath ? <FolderOpen size={14} /> : <Plus size={14} />}
                  <span className={css.dirText}>
                    {pickedPath || typedPath || t("选择目录…")}
                  </span>
                </button>
              </div>
            </div>
          </div>
          <div>
            <div className={css.dlgLabelRow}>
              <span className={rowsCss.fieldLabel}>{t("项目指令")}</span>
              <span className={css.infoIcon} data-tip={t("指令会在创建时写入项目 AGENTS.md，文件已存在则不改动。")}>
                <Info size={14} />
              </span>
            </div>
            <textarea
              className={css.textArea}
              placeholder={t("为这个项目下的会话输入指令…")}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>
          {error && <div className={rowsCss.modelError}>{error}</div>}
        </div>
        <div className={rowsCss.modalFoot}>
          <button className={rowsCss.secondaryButton} onClick={onClose}>{t("取消")}</button>
          <button className={rowsCss.primaryButton} disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? t("创建中…") : t("创建")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
