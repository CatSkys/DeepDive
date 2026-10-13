// 划词命令的编辑弹窗：一条命令的名字与提示词模板（新增与编辑同一张）。
// 只管这一张表单——目录的读写、上限、渲染都在 ./selectionCommands.ts，列表与入口在
// SelectionToolbarSection。

import { useState } from "react";
import rowsCss from "./SettingsRows.module.css";
import { INPUT_PLACEHOLDER, type SelectionCommand } from "./selectionCommands";
import { useT } from "../i18n";
import { GlassLayer } from "../components/GlassLayer";

export function SelectionCommandDialog({ draft, isNew, onCancel, onSave, onDelete }: {
  draft: SelectionCommand;
  isNew: boolean;
  onCancel: () => void;
  onSave: (command: SelectionCommand) => void;
  onDelete: (() => void) | null;
}) {
  const { t, tt } = useT();
  const [name, setName] = useState(draft.name);
  const [prompt, setPrompt] = useState(draft.prompt);
  const canSave = name.trim() !== "" && prompt.trim() !== "";

  const save = () => {
    if (!canSave) return;
    onSave({ ...draft, name: name.trim(), prompt: prompt.trim() });
  };

  return (
    <div className={rowsCss.modalOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className={rowsCss.modal} role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
           <GlassLayer />
        <div className={rowsCss.modalHead}>
          <div className={rowsCss.modalTitle}>{isNew ? t("添加命令") : t("编辑命令")}</div>
        </div>
        <div className={rowsCss.modalBody}>
          <label>
            <span className={rowsCss.fieldLabel}>{t("名字")}</span>
            <input
              className={rowsCss.cmdInput}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("显示在胶囊按钮上")}
            />
          </label>
          <label>
            <span className={rowsCss.fieldLabel}>{t("提示词")}</span>
            <textarea
              className={rowsCss.cmdPrompt}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              spellCheck={false}
            />
            <span className={rowsCss.fieldHint}>
              {tt(`提示词里用 ${INPUT_PLACEHOLDER} 代表选中的文字，没写就接在末尾；其余 {…} 原样发给模型。`,
                `Write ${INPUT_PLACEHOLDER} where the selected text goes; without it the text is appended. Other {…} placeholders are sent to the model as-is.`)}
            </span>
          </label>
        </div>
        <div className={rowsCss.modalFoot}>
          {onDelete && (
            <button type="button" className={rowsCss.dangerButton} onClick={onDelete}>{t("删除")}</button>
          )}
          <button type="button" className={rowsCss.secondaryButton} onClick={onCancel}>{t("取消")}</button>
          <button type="button" className={rowsCss.primaryButton} disabled={!canSave} onClick={save}>{t("保存")}</button>
        </div>
      </div>
    </div>
  );
}
