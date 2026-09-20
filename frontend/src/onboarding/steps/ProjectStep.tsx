// 引导第 3 步·项目：建第一个项目空间（= 工作区，Agent 在这个文件夹里干活）。
// 表单是**与「新建项目」弹窗同一份实现**（components/projectForm.tsx + projectCreate.ts）：
// 名称（行尾图标钮）/ 记忆 / 自进化 / 审批模式 / 工作区文件夹 / 项目指令，版式一致。
import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { useStore } from "../../store";
import { createProject } from "../../components/projectCreate";
import { ProjectFormFields, useProjectForm } from "../../components/projectForm";
import { endWorkspacePick, setWorkspacePickSink } from "../../components/workspacePicker";
import css from "../OnboardingWizard.module.css";

export function ProjectStep() {
  const { t, tt } = useT();
  const store = useStore();
  const form = useProjectForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  // 目录选择器结果路由进本步；卸载即摘（不悬挂给别的入口）。
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
    setCreated(result.path ?? form.name);
    setBusy(false);
  };

  if (created) {
    return (
      <div className={css.step}>
        <div className={css.stepTitle}>{t("项目已创建")}</div>
        <div className={css.stepLead}>
          {tt("「{name}」已就位，Agent 会在这个文件夹里读写文件。", "\"{name}\" is ready — the agent reads and writes files inside this folder.", { name: form.name })}
        </div>
        <div className={css.pathLine}>{created}</div>
      </div>
    );
  }

  return (
    <div className={css.step}>
      <div className={css.stepTitle}>{t("新建项目")}</div>
      <div className={css.stepLead}>
        {t("项目就是一个文件夹：Agent 在里面读写文件、跑命令。先建一个，之后可以再加。")}
      </div>
      <ProjectFormFields form={form} />
      {error && <div className={css.error}>{error}</div>}
      <div className={css.actions}>
        <button type="button" className={css.primary} disabled={busy || !form.canSubmit} onClick={() => void submit()}>
          {busy ? t("创建中…") : t("创建")}
        </button>
      </div>
    </div>
  );
}
