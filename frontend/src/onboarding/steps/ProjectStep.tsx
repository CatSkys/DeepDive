// 引导第 3 步·项目：建第一个项目空间（= 工作区，Agent 在这个文件夹里干活）。
// 表单是**与「新建项目」弹窗同一份实现**（components/projectForm.tsx + projectCreate.ts）：
// 名称（行尾图标钮）/ 记忆 / 自进化 / 审批模式 / 工作区文件夹 / 项目指令，版式一致。
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useT } from "../../i18n";
import { useStore } from "../../store";
import { createProject } from "../../components/projectCreate";
import { ProjectFormFields, useProjectForm } from "../../components/projectForm";
import { endWorkspacePick, setWorkspacePickSink } from "../../components/workspacePicker";
import css from "../OnboardingWizard.module.css";

export function ProjectStep({ onNext, registerPrimary }: {
  onNext: () => void;
  /** 登记底栏主按钮：这里就是"下一步＝创建"。 */
  registerPrimary: (p: { label: string; run: () => void | Promise<void>; disabled?: boolean } | null) => void;
}) {
  const { t } = useT();
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

  // 底栏主按钮：名称填了就创建（成功才前进），没填就直接前进（跳过建项目）。
  useEffect(() => {
    registerPrimary({
      label: busy ? t("创建中…") : t("下一步"),
      disabled: busy,
      run: async () => {
        if (created || !form.canSubmit) { onNext(); return; }
        setError(null);
        setBusy(true);
        const result = await createProject(form.args(), {
          createWorkspace: store.createWorkspace,
          refresh: store.refresh,
        });
        setBusy(false);
        if (result.error) { setError(result.error); return; }
        setCreated(result.path ?? form.name);
        onNext();
      },
    });
    return () => registerPrimary(null);
  });

  return (
    <div className={css.step}>
      <div className={css.stepTitle}>{t("新建项目")}</div>
      <div className={css.stepLead}>
        {t("项目就是一个文件夹：Agent 在里面读写文件、跑命令。先建一个，之后可以再加。")}
      </div>
      <ProjectFormFields form={form} />
      {error && <div className={css.error}>{error}</div>}
      {busy && <div className={css.scanning}><Loader2 size={14} className={css.spin} />{t("创建中…")}</div>}
    </div>
  );
}
