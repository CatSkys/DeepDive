// 新建项目表单弹窗（版式照参考图 Create Project）：名称（必填，行尾内嵌
// 图标触发钮）→ 目录（可选）→ 项目指令（可选 textarea）。OpenHost 挂 App
// 根部，任何入口经 openNewProjectDialog() 打开。
//
// 字段落点（引擎契约实证）：
//   · 目录：workspace/create 只收 path 且要求目录已存在（引擎 workspace 包
//     realpath+stat 校验），所以「留空自动建目录」由壳 prepare-workspace
//     完成（~/Documents/DeepDive Projects/<净化名>，撞名追加序号）；浏览器
//     （无壳桥）建不了目录——降级为目录必填手输、指令字段不出现。
//   · 名称：wire 不收 title，创建后按 workspace/rename 落（自动目录的末级
//     目录名与名称一致时跳过）。
//   · 指令：壳写入 <项目>/AGENTS.md（引擎按 cwd 读它）；已存在不改动。
//   · 图标：纯前端装饰层，按 workspaceId 存 localStorage（wsIcons.ts）。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, Plus } from "lucide-react";
import { api } from "../api";
import { inShell, prepareWorkspace } from "../host";
import { useStore } from "../store";
import { setWsIcon } from "../wsIcons";
import { useT } from "../i18n";
import { IconPicker } from "./IconPicker";
import { beginWorkspacePick, endWorkspacePick } from "./workspacePicker";
import { IconProjectAddOutline16 } from "./Icons";
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

  // 目录选择器结果路由进本弹窗（workspacePicker 模块级 sink），卸载即清。
  useEffect(() => {
    beginWorkspacePick((path) => setPickedPath(path));
    return () => endWorkspacePick();
  }, []);

  const canSubmit = !!name.trim() && (hasShell || !!typedPath.trim()) && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    const trimmed = name.trim();
    setError(null);
    setBusy(true);
    try {
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
      className={css.dlgOverlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-label={t("新建项目")}
    >
      {/* Escape/⌘↵ 挂卡片上（不挂 document）：图标菜单 portal 后仍在本弹窗
          React 子树里，其内部 Escape 已被菜单 stopPropagation 截住，不会
          连带关掉整个弹窗 */}
      <div
        className={css.dlgCard}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
        }}
      >
        <div className={css.dlgHead}>
          <span className={css.dlgChip} aria-hidden="true">
            <IconProjectAddOutline16 size={17} />
          </span>
          <span className={css.dlgTitle}>{t("新建项目")}</span>
        </div>
        <div className={css.dlgBody}>
          <div className={css.groupCard}>
            <div className={css.groupRow}>
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
            <div className={css.groupRow}>
              <span className={css.groupLabel}>{t("目录")}</span>
              <div className={css.groupControl}>
                {hasShell ? (
                  <button
                    type="button"
                    className={`${css.dirBtn}${pickedPath ? ` ${css.filled}` : ""}`}
                    onClick={() => beginWorkspacePick((path) => setPickedPath(path))}
                  >
                    {pickedPath
                      ? <FolderOpen size={14} />
                      : <Plus size={14} />}
                    <span className={css.dirText}>
                      {pickedPath ?? t("选择目录…")}
                    </span>
                  </button>
                ) : (
                  <input
                    className={css.dirInput}
                    placeholder={t("目录（绝对路径）")}
                    value={typedPath}
                    onChange={(e) => setTypedPath(e.target.value)}
                  />
                )}
              </div>
            </div>
          </div>
          {hasShell && (
            <div>
              <span className={css.dlgLabel}>{t("项目指令")}</span>
              <textarea
                className={css.textArea}
                placeholder={t("为这个项目下的会话输入指令…")}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </div>
          )}
          {hasShell && <div className={css.fieldHint}>{t("目录留空则按名称自动创建；指令会在创建时写入项目 AGENTS.md，文件已存在则不改动。")}</div>}
          {error && <div className={css.modelError}>{error}</div>}
        </div>
        <div className={css.dlgFoot}>
          <button className={css.ghostBtn} onClick={onClose}>{t("取消")}</button>
          <button className={css.primaryBtn} disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? t("创建中…") : t("创建")}
            {!busy && <span className={css.keycap} aria-hidden="true">⌘</span>}
            {!busy && <span className={css.keycap} aria-hidden="true">↵</span>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
