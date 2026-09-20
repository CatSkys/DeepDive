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
import { createProject } from "./projectCreate";
import { useStore } from "../store";
import { useT } from "../i18n";
import { ProjectFormFields, useProjectForm } from "./projectForm";
import { endWorkspacePick, setWorkspacePickSink } from "./workspacePicker";
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
  const { t } = useT();
  const store = useStore();
  const form = useProjectForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 目录选择器结果路由进本弹窗（workspacePicker 模块级 sink），卸载即清。
  // 只登记不触发——调起系统面板是工作区文件夹按钮自己的事。
  useEffect(() => {
    setWorkspacePickSink((path) => form.setPickedPath(path));
    return () => endWorkspacePick();
    // 只挂一次：sink 指向 form 的稳定 setter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!form.canSubmit) return;
    setError(null);
    setBusy(true);
    const result = await createProject(form.args(), {
      createWorkspace: store.createWorkspace,
      refresh: store.refresh,
    });
    if (result.error) {
      setError(result.error);
      setBusy(false);
      return;
    }
    onClose();
  };

  return createPortal(
    // 关闭只认"按下 overlay 自身"；图标选择器的 portal 点击沿 React 树冒泡
    <div
      className={rowsCss.modalOverlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      role="dialog"
      aria-label={t("新建项目")}
    >
      {/* Escape/⌘↵ 挂卡片上（不挂 document）：图标选择器 portal 后仍在本弹窗 React
          子树里，其内部 Escape 已被菜单 stopPropagation 截住，不会连带关掉弹窗 */}
      <div
        className={`${rowsCss.modal} ${css.glass}`}
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
          <ProjectFormFields form={form} />
          {error && <div className={rowsCss.modelError}>{error}</div>}
        </div>
        <div className={rowsCss.modalFoot}>
          <button className={rowsCss.secondaryButton} onClick={onClose}>{t("取消")}</button>
          <button className={rowsCss.primaryButton} disabled={!form.canSubmit || busy} onClick={() => void submit()}>
            {busy ? t("创建中…") : t("创建")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
