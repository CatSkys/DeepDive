// 草稿页（新会话）的右侧边栏卡：与应用内那张面板卡同一副几何（.panel），
// 但**只有会话设置页**——草稿页没有会话，产物/目标/任务这些分区无数据可读，
// 屏幕缩略图那一层也由壳按会话摆原生视图（无会话则无槽位）。
//
// 用户定稿：新会话右上角要有会话设置入口（齿轮，同面板顶条那颗），点开直接落在会话设置。
//
// 三个写入面在草稿页的落点（都不新造契约）：
//   模型   —— store.draftModel（首条消息建会话时随 selectModel 带走）
//   权限   —— 引擎 permission 命名空间的 defaultPreset（新会话的初始权限；
//             草稿页还没有会话，`/permission` 那条会话级写路在这里没有对象）
//   发送方式 —— conversation.busyEnter（本来就是全局设置，与设置页同源）
import { useEffect, useRef, useState } from "react";
import { Settings2, X } from "lucide-react";
import { t } from "../i18n";
import { Dropdown } from "../components/controls";
import { ModelMenu } from "../components/ModelMenu";
import { presetDropdownOptions, permissionPresetView } from "../settings/permissionPreset";
import { SettingsConflictError, useSettingNamespace } from "../settings/useSettingNamespace";
import { alertDialog } from "../components/DialogHost";
import type { PermissionSettingsView } from "../settings/permissionPreset";
import type { ModelFace } from "../session/SessionHeader";

export function HeroPanel({ face, open, onClose, reloadModels }: {
  face: ModelFace;
  open: boolean;
  onClose: () => void;
  /** 打开模型菜单时重拉目录（草稿页的目录只有 App 手里那份；启动期引擎未就绪
   *  会留空，picker 每次打开都要重拉——与 App 里那条 effect 同一策略）。 */
  reloadModels: () => void;
}) {
  const [showModels, setShowModels] = useState(false);
  const [busy, setBusy] = useState("");
  const [permission, setPermission] = useState<PermissionSettingsView | null>(null);
  /** 模型菜单的定位锚（弹层按它的 rect 摆，且点它不算"点外部"）。 */
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const { describe: describeUiNs, update: updateUiNs } = useSettingNamespace("conversation");
  const { describe: describePermNs, update: updatePermNs } = useSettingNamespace("permission");

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const v = ((await describeUiNs())?.value as { busyEnter?: string } | null)?.busyEnter;
        if (v) setBusy(v);
      } catch { /* engine booting */ }
      try {
        setPermission(permissionPresetView(await describePermNs()));
      } catch { /* engine booting */ }
    })();
  }, [open, describeUiNs, describePermNs]);

  // 菜单每次打开都重拉目录——目录在启动期可能是空的（引擎还没起），只在挂载时拉
  // 一次会永久留空，表现为"点模型行没反应"（App 里那条 header picker 的 effect 同理）。
  useEffect(() => {
    if (open && showModels) reloadModels();
  }, [open, showModels, reloadModels]);

  useEffect(() => {
    if (!open) setShowModels(false);
  }, [open]);

  const saveBusy = async (v: string) => {
    setBusy(v);
    try {
      await updateUiNs({ busyEnter: v });
    } catch (err) {
      void alertDialog(err instanceof SettingsConflictError
        ? { message: t("版本已前进——请取消后重新打开(将载入最新)") }
        : { message: t("保存失败") });
    }
  };

  const savePermission = async (v: string) => {
    setPermission((cur) => (cur ? { ...cur, current: v } : cur));
    try {
      await updatePermNs({ defaultPreset: v });
    } catch (err) {
      void alertDialog(err instanceof SettingsConflictError
        ? { message: t("版本已前进——请取消后重新打开(将载入最新)") }
        : { message: t("保存失败") });
    }
  };

  // 与 SessionPanel 同一形状：卡片常驻、只切收起态，开合是 CSS transition（见 theme.css .panel）。
  if (!open) return <aside className="panel hero-panel" data-mode="settings" data-closed="true" />;

  return (
    <aside className="panel hero-panel" data-mode="settings">
      <div className="panel-head">
        <span className="panel-head-title">{t("会话设置")}</span>
        <div className="panel-controls">
          <button type="button" className="panel-icon-btn" aria-label={t("收起")} data-tip={t("收起")} onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="panel-body">
        <div className="panel-settings">
          <div className="panel-settings-section">
            <div className="panel-settings-label">{t("模型")}</div>
            <button
              ref={modelTriggerRef}
              type="button"
              className="panel-settings-row"
              data-open={showModels ? "true" : "false"}
              onClick={() => setShowModels((v) => !v)}
            >
              <span className="panel-settings-value">{face.modelName || t("跟随默认")}</span>
              <span className="panel-settings-meta">{face.effortLabel(face.effort)}</span>
            </button>
            {/* 目录为空也照开（引擎未就绪时给"无匹配模型"这句反馈，而不是点了没反应——
                ModelMenu 自己有空态；会话设置那边同样是这个口径） */}
            {showModels && (
              <ModelMenu
                options={face.models}
                current={face.modelName}
                currentModel={face.currentModel}
                effortValue={face.effort}
                onPick={(m) => void face.pickModel(m)}
                onApplyEffort={(m, id) => void face.applyModelEffort(m, id)}
                onClose={() => setShowModels(false)}
                anchorRef={modelTriggerRef}
              />
            )}
          </div>

          {permission !== null && (
            <div className="panel-settings-section">
              <div className="panel-settings-label">{t("权限")}</div>
              <Dropdown block options={presetDropdownOptions(permission.options, t)} value={permission.current} onChange={(v) => void savePermission(v)} />
              <div className="panel-settings-hint">{t("新建会话的初始权限。")}</div>
            </div>
          )}

          <div className="panel-settings-section">
            <div className="panel-settings-label">{t("发送方式")}</div>
            <Dropdown
              block
              options={[{ v: "steer", label: t("插话发送") }, { v: "queue", label: t("排队") }]}
              value={busy}
              onChange={(v) => void saveBusy(v)}
            />
            <div className="panel-settings-hint">{t("仅在智能体运行时生效;Cmd/Ctrl+Enter 使用另一行为")}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** 草稿页右上角的会话设置入口：坐会话页那颗边栏入口的位置（同尺寸、同位置——
 *  .hero 是定位祖先，右 16 / 上 8 正好落在会话头那颗的位置上），**glyph 不同**：
 *  草稿页没有会话，点开直接进会话设置，所以画的是设置齿轮（与会话面板顶条那颗
 *  同一枚 `Settings2`），不画边栏图标。 */
export function HeroPanelTrigger({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  if (open) return null;
  return (
    <button
      type="button"
      className="panel-expand-btn hero-panel-btn"
      aria-label={t("会话设置")}
      data-tip={t("会话设置")}
      onClick={onToggle}
    >
      <Settings2 size={15} />
    </button>
  );
}
