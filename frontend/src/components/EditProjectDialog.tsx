// 编辑项目弹窗：项目 ⋯ 菜单「编辑项目」唤出——复用新建项目的表单
// （ProjectFormFields），把已建项目的现值填回去：名称（workspace/rename）、
// 图标（localStorage）、项目指令（AGENTS.md 预填，保存经壳覆写）。
// 工作区文件夹是项目身份，编辑态只展示不可改（fixedPath）。
// 保存是三步显式编排（改名→图标→指令），一步失败即报错停住，不做部分成功。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { fileUrlOf } from "./preview/previewModel";
import { writeProjectAgents } from "../host";
import { useStore } from "../store";
import { useT } from "../i18n";
import { clearWsIcon, getWsIcon, setWsIcon } from "../wsIcons";
import type { WorkspaceView } from "../types";
import { ProjectFormFields, useProjectForm } from "./projectForm";
import rowsCss from "../settings/SettingsRows.module.css";
import css from "./NewProjectDialog.module.css";

let editReq: ((ws: WorkspaceView) => void) | null = null;

/** 「编辑项目」的唯一入口（项目 ⋯ 菜单）。 */
export function openEditProjectDialog(ws: WorkspaceView): void {
  editReq?.(ws);
}

/** App 根部挂一次：消费 openEditProjectDialog 请求。 */
export function EditProjectDialogHost() {
  const [ws, setWs] = useState<WorkspaceView | null>(null);
  useEffect(() => {
    editReq = setWs;
    return () => { editReq = null; };
  }, []);
  return ws ? <EditProjectDialog ws={ws} onClose={() => setWs(null)} /> : null;
}

function EditProjectDialog({ ws, onClose }: { ws: WorkspaceView; onClose: () => void }) {
  const { t } = useT();
  const store = useStore();
  const form = useProjectForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 打开时的指令原文：保存时只在与它不同才写盘（没动就不碰文件）。 */
  const [initialInstructions, setInitialInstructions] = useState<string | null>(null);

  // 现值填回：名称/图标同步取，指令异步读项目的 AGENTS.md（缺失=空）。
  useEffect(() => {
    form.setName(ws.title);
    form.setGlyph(getWsIcon(ws.workspaceId));
    let alive = true;
    fetch(fileUrlOf(`${ws.path}/AGENTS.md`))
      .then((r) => (r.ok ? r.text() : ""))
      .then((text) => {
        if (!alive) return;
        form.setInstructions(text);
        setInitialInstructions(text);
      })
      .catch(() => { if (alive) setInitialInstructions(""); });
    return () => { alive = false; };
    // 只在打开时填一次：ws 由弹窗持有，重开是重新挂载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.workspaceId]);

  // 指令原文还没读到（读盘中/读挂了）就不放行保存：否则"没动指令就不写盘"
  // 的判定会拿着 null 静默跳过写盘，用户改了也白改。
  const loaded = initialInstructions !== null;

  const submit = async () => {
    if (!form.canSubmit || busy || !loaded) return;
    setError(null);
    setBusy(true);
    const name = form.name.trim();
    try {
      if (name !== ws.title) {
        await api.workspaceRename({ workspaceId: ws.workspaceId, title: name });
        await store.refresh();
      }
      // 图标是纯前端装饰层：选了就记，选「默认」就清（与 ⋯ 菜单的修改图标同一落点）
      if (form.glyph) setWsIcon(ws.workspaceId, form.glyph);
      else clearWsIcon(ws.workspaceId);
      const instructions = form.instructions.trim();
      if (initialInstructions !== null && instructions !== initialInstructions.trim()) {
        const r = await writeProjectAgents({ path: ws.path, instructions });
        if (!r.ok) {
          setError(r.error ?? t("保存项目指令失败。"));
          setBusy(false);
          return;
        }
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className={rowsCss.modalOverlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      role="dialog"
      aria-label={t("编辑项目")}
    >
      <div
        className={`${rowsCss.modal} ${css.glass}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
        }}
      >
        <div className={rowsCss.modalHead}>
          <span className={rowsCss.modalTitle}>{t("编辑项目")}</span>
        </div>
        <div className={rowsCss.modalBody}>
          <ProjectFormFields form={form} fixedPath={ws.path} />
          {error && <div className={rowsCss.modelError}>{error}</div>}
        </div>
        <div className={rowsCss.modalFoot}>
          <button className={rowsCss.secondaryButton} onClick={onClose}>{t("取消")}</button>
          <button className={rowsCss.primaryButton} disabled={!form.canSubmit || busy || !loaded} onClick={() => void submit()}>
            {busy ? t("保存中…") : t("保存")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
