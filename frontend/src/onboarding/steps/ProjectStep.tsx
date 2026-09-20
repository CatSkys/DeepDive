// 引导第 3 步·项目：建第一个项目空间（= 工作区，Agent 在这个文件夹里干活）。
// 表单是卡内自己的（不弹现有的「新建项目」弹窗），但**建项目的编排与弹窗共用同一份
// 实现**（components/projectCreate.ts）：壳自动建目录 + 写 AGENTS.md，引擎注册工作区。
import { useEffect, useState } from "react";
import { ArrowRight, FolderOpen, Loader2 } from "lucide-react";
import { useT } from "../../i18n";
import { useStore } from "../../store";
import { createProject } from "../../components/projectCreate";
import { beginWorkspacePick, endWorkspacePick } from "../../components/workspacePicker";
import css from "../OnboardingWizard.module.css";

export function ProjectStep({ onNext }: { onNext: () => void }) {
  const { t, tt } = useT();
  const store = useStore();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  // 目录选择器的结果只在挂载期内归本步；卸载即摘（不悬挂给别的入口）。
  useEffect(() => () => endWorkspacePick(), []);

  const pick = () => {
    setError(null);
    beginWorkspacePick((path) => setPicked(path));
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await createProject(
      { name, ...(picked ? { path: picked } : {}), hasShell: true },
      { createWorkspace: store.createWorkspace, refresh: store.refresh },
    );
    if (result.error) {
      setError(result.error);
      setBusy(false);
      return;
    }
    setCreated(result.path ?? name);
    setBusy(false);
  };

  if (created) {
    return (
      <div className={css.step}>
        <div className={css.stepTitle}>{t("项目已创建")}</div>
        <div className={css.stepLead}>
          {tt("「{name}」已就位，Agent 会在这个文件夹里读写文件。", "\"{name}\" is ready — the agent works inside this folder.", { name })}
        </div>
        <div className={css.pathLine}>{created}</div>
        <div className={css.actions}>
          <button type="button" className={css.primary} onClick={onNext}>
            {t("下一步")}<ArrowRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={css.step}>
      <div className={css.stepTitle}>{t("新建项目")}</div>
      <div className={css.stepLead}>
        {t("项目就是一个文件夹：Agent 在里面读写文件、跑命令。先建一个，之后可以再加。")}
      </div>
      <label className={css.fieldLabel} htmlFor="onboarding-project">{t("项目名称")}</label>
      <input
        id="onboarding-project"
        className={css.field}
        value={name}
        placeholder={t("例如：我的网站")}
        onChange={(e) => setName(e.target.value)}
      />
      <div className={css.folderRow}>
        <button type="button" className={css.secondary} onClick={pick}>
          <FolderOpen size={14} />{t("选择文件夹…")}
        </button>
        <span className={css.rowMeta}>{picked || t("留空则在文稿/DeepDive Projects 下自动新建")}</span>
      </div>
      {error && <div className={css.error}>{error}</div>}
      <div className={css.actions}>
        <button type="button" className={css.primary} disabled={busy || name.trim().length === 0} onClick={() => void submit()}>
          {busy ? <><Loader2 size={14} className={css.spin} />{t("创建中…")}</> : t("创建项目")}
        </button>
        <button type="button" className={css.secondary} disabled={busy} onClick={onNext}>{t("跳过这一步")}</button>
      </div>
    </div>
  );
}
