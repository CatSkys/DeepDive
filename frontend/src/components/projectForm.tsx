// 新建项目表单的字段与状态：**唯一一份**——「新建项目」弹窗与新手引导卡的「新建项目」
// 步共用（版式照 Create Project 参考图：名称（行尾内嵌图标钮）→ 审批模式
// → 工作区文件夹 → 项目指令）。管什么：字段、校验、提交参数；不管什么：弹窗壳、页脚、
// 提交本身（走 components/projectCreate.ts）。
//
// 字段落点（引擎契约实证，改动前先读 NewProjectDialog 的旧注释）：目录由壳
// prepare-workspace 建（引擎 workspace/create 只收已存在的 path）；名称创建后按
// workspace/rename 落；指令由壳写入 <项目>/AGENTS.md；图标是纯前端 localStorage 装饰。
import { useEffect, useState } from "react";
import { FolderOpen, Info, Plus } from "lucide-react";
import { inShell } from "../host";
import { useT } from "../i18n";
import { permissionPresetView, type PermissionSettingsView } from "../settings/permissionPreset";
import { useSettingNamespace } from "../settings/useSettingNamespace";
import { PRESET_META } from "./SettingsPage";
import { promptDialog } from "./DialogHost";
import { Dropdown } from "./controls";
import { IconPicker } from "./IconPicker";
import { beginWorkspacePick } from "./workspacePicker";
import rowsCss from "../settings/SettingsRows.module.css";
import css from "./NewProjectDialog.module.css";

export interface ProjectForm {
  name: string;
  setName: (v: string) => void;
  glyph: string | null;
  setGlyph: (v: string | null) => void;
  pickedPath: string | null;
  setPickedPath: (v: string | null) => void;
  typedPath: string;
  setTypedPath: (v: string) => void;
  instructions: string;
  setInstructions: (v: string) => void;
  /** 提交门槛（与弹窗一致：名称必填；有壳桥时目录可留空由壳建）。 */
  canSubmit: boolean;
  /** 提交参数（弹窗与引导卡都把它交给 createProject）。 */
  args: () => { name: string; path?: string; instructions?: string; glyph?: string; hasShell: boolean };
  permission: PermissionSettingsView | null;
  setApproval: (v: string) => Promise<void>;
}

export function useProjectForm(): ProjectForm {
  const hasShell = inShell();
  const [name, setName] = useState("");
  const [glyph, setGlyph] = useState<string | null>(null);
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const [typedPath, setTypedPath] = useState("");
  const [instructions, setInstructions] = useState("");

  // 审批模式：与设置页「审批」同一数据源（permission.defaultPreset，新会话的初始
  // 权限预设）。null = 引擎未提供该命名空间（隐藏这一行）。
  const [permission, setPermission] = useState<PermissionSettingsView | null>(null);
  const { describe: describePerm, update: updatePerm } = useSettingNamespace("permission");
  useEffect(() => {
    let alive = true;
    describePerm()
      .then((ns) => { if (alive) setPermission(permissionPresetView(ns)); })
      .catch(() => { if (alive) setPermission(null); });
    return () => { alive = false; };
  }, [describePerm]);

  const canSubmit = !!name.trim() && (hasShell || !!typedPath.trim());
  const path = pickedPath ?? (typedPath.trim() || undefined);
  return {
    name, setName, glyph, setGlyph, pickedPath, setPickedPath, typedPath, setTypedPath,
    instructions, setInstructions,
    canSubmit,
    args: () => ({
      name,
      ...(path ? { path } : {}),
      ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
      ...(glyph ? { glyph } : {}),
      hasShell,
    }),
    permission,
    setApproval: async (v: string) => {
      // 乐观显示 + 写后重读（与弹窗同款；失败由调用方按返回值/异常处理——这里保留
      // 乐观值，因为引擎重启窗口期的读失败不该把用户刚选的档位弹回去）。
      setPermission((cur) => (cur ? { ...cur, current: v } : cur));
      try {
        await updatePerm({ defaultPreset: v });
      } finally {
        describePerm()
          .then((ns) => setPermission(permissionPresetView(ns)))
          .catch(() => { /* 引擎重启窗口期：保留乐观值 */ });
      }
    },
  };
}

export function ProjectFormFields({ form }: { form: ProjectForm }) {
  const { t } = useT();
  const hasShell = inShell();
  const { permission } = form;
  return (
    <>
      <div className={rowsCss.rowGroup}>
        <div className={rowsCss.rowCard}>
          <span className={css.groupLabel}>{t("项目名称")}</span>
          <div className={css.groupControl}>
            <div className={css.nameField}>
              <input
                className={css.nameInput}
                placeholder={t("项目名称")}
                value={form.name}
                onChange={(e) => form.setName(e.target.value)}
                autoFocus
              />
              <IconPicker value={form.glyph} label={form.name} onChange={form.setGlyph} />
            </div>
          </div>
        </div>
        {permission && (
          <div className={rowsCss.rowCard}>
            <span className={css.groupLabel}>{t("审批模式")}</span>
            <div className={`${css.groupControl} ${css.rowRight}`}>
              <Dropdown
                options={permission.options.map((o) => {
                  const meta = PRESET_META[o.value];
                  return {
                    v: o.value,
                    label: meta ? t(meta.label) : o.label,
                    description: meta ? t(meta.desc) : undefined,
                    icon: meta?.icon,
                    danger: meta?.danger,
                  };
                })}
                value={permission.current}
                onChange={(v) => void form.setApproval(v)}
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
              className={`${css.dirBtn}${form.pickedPath || form.typedPath ? ` ${css.filled}` : ""}`}
              onClick={() => {
                if (hasShell) {
                  // 壳原生目录选择器：结果经 workspacePicked 回到这里
                  beginWorkspacePick((p) => form.setPickedPath(p));
                } else {
                  // 浏览器降级：无壳桥建不了目录，弹输入框手输绝对路径
                  void promptDialog({
                    title: t("输入要添加为工作空间的文件夹绝对路径："),
                    initialValue: form.typedPath,
                  }).then((p) => { if (p && p.trim()) form.setTypedPath(p.trim()); });
                }
              }}
            >
              {form.pickedPath || form.typedPath ? <FolderOpen size={14} /> : <Plus size={14} />}
              <span className={css.dirText}>
                {form.pickedPath || form.typedPath || t("选择目录…")}
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
          value={form.instructions}
          onChange={(e) => form.setInstructions(e.target.value)}
        />
      </div>
    </>
  );
}
