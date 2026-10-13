// 命令中心的**设置模式**行件：左标签、右取值/控件的设置行，按当前脸给行集——
//   草稿脸（无会话）：模型 / 思考强度 / 权限（新会话的初始权限）/ 发送方式
//   会话脸：模型 / 思考强度 / 权限（当前会话）/ 会话模式 / 发送方式
// 行只是把**同一批既有原语**换一种排布（Dropdown variant="bare"、ModelMenu、
// presetDropdownOptions、shownLevel、useSettingNamespace 的两个命名空间、会话模式走
// agentPresets/select），写入路径不新增——与 HeroPanel / SessionSettings 同源，
// 不是第二份实现。「插件」不进面板：主窗设置页的事（面板求简洁）。
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, CircleAlert } from "lucide-react";
import { api } from "../api";
import { t, tt } from "../i18n";
import { alertDialog } from "../components/DialogHost";
import { Dropdown } from "../components/controls";
import { ModelMenu } from "../components/ModelMenu";
import { shownLevel } from "../components/composer/EffortPicker";
import { agentPresetLabel, visibleAgentPresets } from "../settings/agentPreset";
import {
  permissionPresetView, presetDropdownOptions,
  type PermissionSelect, type PermissionSettingsView,
} from "../settings/permissionPreset";
import { SettingsConflictError, useSettingNamespace } from "../settings/useSettingNamespace";
import { useStore } from "../store";
import { useSessionModels } from "../session/useSessionModels";
import { modeOverrides } from "../sidebar-right/SessionSettings";
import { useDraftModelFace } from "../useDraftModelFace";
import type { ModelFace } from "../session/SessionHeader";

interface SettingRow {
  key: string;
  /** 参与搜索过滤（与显示文案同一份）。 */
  label: string;
  node: ReactNode;
}

/** 行的外壳：标签左、控件右（几何与 hover 复用面板设置行那套 .panel-settings-line）。 */
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="panel-settings-line">
      <div className="panel-settings-identity">
        <div className="panel-settings-label">
          {label}
          {hint && <CircleAlert size={12} className="panel-settings-hint-icon" data-tip={hint} />}
        </div>
      </div>
      <span className="panel-settings-value">{children}</span>
    </div>
  );
}

/** 模型行：整行可点弹 ModelMenu。 */
function ModelRow({ face }: { face: ModelFace }) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="panel-settings-line panel-settings-row"
        data-open={face.showModels ? "true" : "false"}
        onClick={() => face.setShowModels(true)}
      >
        <span className="panel-settings-label">{t("模型")}</span>
        <span className="panel-settings-value">
          <span className="panel-settings-value-text">{face.modelName || t("跟随默认")}</span>
          <ChevronDown size={14} className="panel-settings-chev" />
        </span>
      </button>
      {face.showModels && (
        <ModelMenu
          options={face.models}
          current={face.modelName}
          currentModel={face.currentModel}
          onPick={(m) => void face.pickModel(m)}
          onClose={() => face.setShowModels(false)}
          anchorRef={triggerRef}
        />
      )}
    </>
  );
}

const saveFailed = (err: unknown) => {
  void alertDialog(err instanceof SettingsConflictError
    ? { message: t("版本已前进——请取消后重新打开(将载入最新)") }
    : { message: tt("保存失败：{m}", "Save failed: {m}", { m: (err as Error).message }) });
};

/** 发送方式行：引擎 conversation.busyEnter（全局设置，与设置页同源）。两脸共用一份。 */
function BusyRow() {
  const { describe, update } = useSettingNamespace("conversation");
  const [busy, setBusy] = useState("queue");
  useEffect(() => {
    void (async () => {
      try {
        const v = ((await describe())?.value as { busyEnter?: string } | null)?.busyEnter;
        if (v) setBusy(v);
      } catch { /* engine booting */ }
    })();
  }, [describe]);
  return (
    <Row label={t("发送方式")}>
      <Dropdown
        options={[{ v: "steer", label: t("插话发送") }, { v: "queue", label: t("排队") }]}
        value={busy}
        onChange={(v) => {
          setBusy(v);
          void update({ busyEnter: v }).catch(saveFailed);
        }}
        variant="bare"
      />
    </Row>
  );
}

/** 思考强度行：档位表由模型能力元数据给（调用方只在有档位时才出这一行）。 */
function EffortRow({ face }: { face: ModelFace }) {
  return (
    <Row label={t("思考强度")}>
      <Dropdown
        options={(face.effortLevels ?? []).map((l) => ({ v: l.id, label: l.name }))}
        value={shownLevel(face.effort, face.effortLevels ?? [])}
        onChange={(v) => void face.pickEffort?.(v)}
        variant="bare"
      />
    </Row>
  );
}

/** 行清单 + 搜索过滤（两脸共用）。 */
function SettingRows({ query, rows }: { query: string; rows: (SettingRow | null)[] }) {
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r): r is SettingRow => r !== null).filter((r) => !q || r.label.toLowerCase().includes(q));
  return (
    <div className="panel-settings mini-cc-settings">
      {shown.map((r) => <div key={r.key}>{r.node}</div>)}
      {shown.length === 0 && <p className="mini-cc-empty">{t("没有匹配的设置")}</p>}
    </div>
  );
}

/** 草稿脸：权限写引擎 permission 命名空间的 defaultPreset（新会话的初始权限）。 */
function DraftSettings({ query }: { query: string }) {
  const { face, reloadModels } = useDraftModelFace();
  const { describe, update } = useSettingNamespace("permission");
  const [permission, setPermission] = useState<PermissionSettingsView | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        setPermission(permissionPresetView(await describe()));
      } catch { /* engine booting */ }
    })();
  }, [describe]);
  // 菜单每次打开都重拉目录（与 HeroPanel 同一条：启动期目录可能是空的，只在挂载时拉
  // 一次会永久留空，表现为"点模型行没反应"）。
  useEffect(() => {
    if (face.showModels) reloadModels();
  }, [face.showModels, reloadModels]);
  const save = async (v: string) => {
    setPermission((cur) => (cur ? { ...cur, current: v } : cur));
    try {
      await update({ defaultPreset: v });
    } catch (err) {
      saveFailed(err);
    }
  };
  const hasEffort = (face.effortLevels?.length ?? 0) > 0;
  return (
    <SettingRows
      query={query}
      rows={[
        { key: "model", label: t("模型"), node: <ModelRow face={face} /> },
        hasEffort ? { key: "effort", label: t("思考强度"), node: <EffortRow face={face} /> } : null,
        permission === null ? null : {
          key: "permission",
          label: t("权限"),
          node: (
            <Row label={t("权限")} hint={t("新建会话的初始权限。")}>
              <Dropdown
                options={presetDropdownOptions(permission.options, t)}
                value={permission.current}
                onChange={(v) => void save(v)}
                variant="bare"
              />
            </Row>
          ),
        },
        { key: "busy", label: t("发送方式"), node: <BusyRow /> },
      ]}
    />
  );
}

/** 会话脸：权限走投影视图 + `/permission` 命令；会话模式走 agentPresets/select。 */
function SessionSettings({ sessionId, query }: { sessionId: string; query: string }) {
  const store = useStore();
  const face = useSessionModels(sessionId);
  const summary = store.sessions.find((s) => s.sessionId === sessionId);
  const select = (summary?.projections?.values as { permissions?: PermissionSelect } | undefined)?.permissions ?? null;
  /** 本地乐观值只用于点击后立刻反映；投影推进后以投影为准（与设置卡同口径）。 */
  const [picked, setPicked] = useState<string | null>(null);
  const permission = picked ?? select?.currentValue ?? "";

  const modeOptions = visibleAgentPresets(store.presets).map((p) => ({ v: p.id, label: agentPresetLabel(p) }));
  const pinned = modeOverrides.get(sessionId) ?? summary?.agentPreset ?? "";
  // 当前会话 pin 的模式不在开放清单（用户自建预设）也照实列出，别让下拉显示成空
  const sessionModeOptions = pinned && !modeOptions.some((o) => o.v === pinned)
    ? [{ v: pinned, label: pinned }, ...modeOptions]
    : modeOptions;

  const hasEffort = (face.effortLevels?.length ?? 0) > 0;
  return (
    <SettingRows
      query={query}
      rows={[
        { key: "model", label: t("模型"), node: <ModelRow face={face} /> },
        hasEffort ? { key: "effort", label: t("思考强度"), node: <EffortRow face={face} /> } : null,
        select === null ? null : {
          key: "permission",
          label: t("权限"),
          node: (
            <Row label={t("权限")}>
              <Dropdown
                options={presetDropdownOptions(select.options, t)}
                value={permission}
                onChange={(v) => {
                  // 引擎只有命令这一条写路；失败（会话不在跑/引擎忙）由投影纠偏，不静默兜底
                  setPicked(v);
                  void api.commandExecute({ agentId: sessionId, line: `/permission ${v}` }).catch(() => undefined);
                }}
                variant="bare"
              />
            </Row>
          ),
        },
        sessionModeOptions.length === 0 ? null : {
          key: "mode",
          label: t("会话模式"),
          node: (
            <Row label={t("会话模式")}>
              <Dropdown
                options={sessionModeOptions}
                value={pinned || undefined}
                onChange={(v) => {
                  modeOverrides.set(sessionId, v);
                  void api.agentPresetSelect({ agentId: sessionId, agentPreset: v }).catch((err) => {
                    modeOverrides.delete(sessionId);
                    void alertDialog({ message: tt("切换失败：{m}", "Switch failed: {m}", { m: (err as Error).message }) });
                  });
                }}
                variant="bare"
              />
            </Row>
          ),
        },
        { key: "busy", label: t("发送方式"), node: <BusyRow /> },
      ]}
    />
  );
}

/** 设置模式入口：按有没有活动会话交给对应那一支（两支各自调自己的 hook，不条件调 hook）。 */
export function MiniSettingsRows({ sessionId, query }: { sessionId: string | null; query: string }) {
  return sessionId === null
    ? <DraftSettings query={query} />
    : <SessionSettings sessionId={sessionId} query={query} />;
}
