// 命令中心的**设置模式**：根行（左标签、右当前值）+ **卡内翻页**——点一行翻到那一页的
// 选项列表，选中即写回并退回根行（用户 2026-10-13 定稿："模型页面相当于一个单独的页面，
// 是在命令中心里面进行跳转的"；不再弹主窗那套模型菜单 / 下拉）。
//
// 按当前脸给行集——草稿脸：模型 / 思考强度 / 权限（新会话的初始权限）/ 发送方式；
// 会话脸：模型 / 思考强度 / 权限（当前会话）/ 会话模式 / 发送方式。
// 写入路径全是既有那些（useDraftModelFace / useSessionModels / useSettingNamespace 的
// permission·conversation 命名空间 / agentPresets+select / `/permission` 命令），
// 与 HeroPanel、SessionSettings 同源，不是第二份实现。选择页本身只有 MiniChoicePage 一个件。
// 「插件」不进面板：主窗设置页的事（面板求简洁）。
import { useEffect, useState } from "react";
import { Bot, ChevronRight, CircleAlert, Cpu, Gauge, Send } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "../api";
import { t as tRaw, tt } from "../i18n";
import { alertDialog } from "../components/DialogHost";
import { modelKey, modelSections } from "../components/ModelMenu";
import { effortDisplayName, shownLevel } from "../components/composer/EffortPicker";
import { agentPresetLabel, visibleAgentPresets } from "../settings/agentPreset";
import {
  permissionPresetView, presetDropdownOptions, presetIcon,
  type PermissionSelect, type PermissionSettingsView,
} from "../settings/permissionPreset";
import { comboFor } from "../keybinds";
import { SettingsConflictError, useSettingNamespace } from "../settings/useSettingNamespace";
import { useStore } from "../store";
import { useSessionModels } from "../session/useSessionModels";
import { modeOverrides } from "../sidebar-right/SessionSettings";
import { useDraftModelFace } from "../useDraftModelFace";
import { MiniChoicePage, flattenChoices, type ChoiceSection } from "./MiniChoicePage";
import type { KeyHandler } from "./MiniCommandCenter";
import type { ModelFace } from "../session/SessionHeader";

/** 一页设置：根行右边那颗当前值 + 翻页后的选项集 + 写回。 */
interface SettingsPage {
  id: string;
  /** 根行左侧的图标（与主窗命令面板的行同一套解剖：icon + 名称 + 快捷键 + 右侧当前值）。 */
  icon: LucideIcon;
  /** 根行的标签。 */
  label: string;
  /** 这一页对应的全局快捷键（有就画成键帽，与命令面板同一套 `.tip-key`）；没有就空着。 */
  combo?: string;
  /** 根行右边的当前值（人可读）。 */
  value: string;
  /** 选项里打勾的那条（`ChoiceOption.v`）。 */
  valueId: string | undefined;
  sections: ChoiceSection[];
  hint?: string;
  pick: (v: string) => void;
}

const saveFailed = (err: unknown) => {
  void alertDialog(err instanceof SettingsConflictError
    ? { message: tRaw("版本已前进——请取消后重新打开(将载入最新)") }
    : { message: tt("保存失败：{m}", "Save failed: {m}", { m: (err as Error).message }) });
};

/** 发送方式（引擎 conversation.busyEnter，全局设置，与设置页同源）。两脸共用一份。 */
function useBusyEnter(): { value: string; set: (v: string) => void } {
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
  return {
    value: busy,
    set: (v) => {
      setBusy(v);
      void update({ busyEnter: v }).catch(saveFailed);
    },
  };
}

function busyPage(busy: { value: string; set: (v: string) => void }): SettingsPage {
  const options = [{ v: "steer", label: tRaw("插话发送") }, { v: "queue", label: tRaw("排队") }];
  return {
    id: "busy",
    icon: Send,
    label: tRaw("发送方式"),
    value: options.find((o) => o.v === busy.value)?.label ?? busy.value,
    valueId: busy.value,
    sections: [{ key: "busy", options }],
    pick: busy.set,
  };
}

/** 模型页（两脸共用取数口径；写回由各家的 face 给）。 */
function modelPage(face: ModelFace): SettingsPage {
  const sections = modelSections(face.models).map((g) => ({
    key: g.label,
    title: g.label,
    options: g.items.map((m) => ({ v: modelKey(m), label: m.label })),
  }));
  return {
    id: "model",
    icon: Cpu,
    label: tRaw("模型"),
    value: face.modelName || tRaw("跟随默认"),
    valueId: face.currentModel ? `${face.currentModel.provider}/${face.currentModel.model}` : undefined,
    sections,
    pick: (v) => {
      const m = face.models.find((o) => modelKey(o) === v);
      if (m) void face.pickModel(m);
    },
  };
}

/** 思考强度页。档位表空 = 模型不支持调档 → 调用方整页不出（见各脸）。
 *  `combo` 由调用方给（`comboFor("cycle-effort", keybinds)`）：同一件事在命令面板里就带键帽，
 *  两处显示同一个键（PITFALLS §4.28 ④：键帽一律 comboFor，不许写死）。 */
function effortPage(face: ModelFace, combo?: string): SettingsPage {
  const levels = face.effortLevels ?? [];
  const id = shownLevel(face.effort, levels);
  return {
    id: "effort",
    icon: Gauge,
    combo,
    label: tRaw("思考强度"),
    value: effortDisplayName(id, levels),
    valueId: id,
    sections: [{ key: "effort", options: levels.map((l) => ({ v: l.id, label: l.name })) }],
    pick: (v) => void face.pickEffort?.(v),
  };
}

/** 根行：左标签（可带说明图标）、右当前值 + 指出去下一页的箭头。
 *  cursor = 键盘光标（↑↓ 走到这一行）：设置模式此前只有取值没有选中态，用户看不出回车
 *  会开哪一页——与历史行同一档填充（hover 5% / 选中 10%，见 theme.css 那两条）。 */
function SettingRow({ page, cursor, onOpen }: { page: SettingsPage; cursor: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="panel-settings-line panel-settings-row"
      data-cursor={cursor || undefined}
      onClick={onOpen}
    >
      <span className="panel-settings-icon"><page.icon size={15} /></span>
      <span className="panel-settings-label">
        {page.label}
        {page.hint !== undefined && <CircleAlert size={12} className="panel-settings-hint-icon" data-tip={page.hint} />}
      </span>
      {page.combo !== undefined && (
        <span className="tip-keys-row outline">
          {[...page.combo].map((ch, i) => <kbd key={i} className="tip-key">{ch}</kbd>)}
        </span>
      )}
      <span className="panel-settings-value">
        <span className="panel-settings-value-text">{page.value}</span>
        <ChevronRight size={14} className="panel-settings-chev" />
      </span>
    </button>
  );
}

interface ShellProps {
  registerKeys: (handler: KeyHandler) => void;
}

/** 设置模式的壳：根行 ↔ 选择页的翻页、搜索过滤与键盘，两脸共用（只喂 pages）。 */
function SettingsShell({
  pages,
  registerKeys,
  onOpenPage,
}: ShellProps & {
  pages: SettingsPage[];
  /** 打开某页时的钩子（草稿脸的模型页借它重拉目录）。 */
  onOpenPage?: (id: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  // 页可能因取数未到而缺席（如权限投影还没来）：找不到就按根行处理，不留半张空页
  const open = pages.find((p) => p.id === openId) ?? null;
  // 设置脸没有搜索框（用户 2026-10-13 定稿："它就是一块设置页面"），所以行集与选项都不再过滤
  const rows = pages;
  const choices = open === null ? [] : flattenChoices(open.sections);

  useEffect(() => { setCursor(0); }, [openId]);

  const back = () => setOpenId(null);

  useEffect(() => {
    registerKeys((e) => {
      if (e.key === "Escape" && open !== null) {
        back();
        return true;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const len = open === null ? rows.length : choices.length;
        if (len === 0) return true;
        e.preventDefault();
        setCursor((c) => (e.key === "ArrowDown" ? Math.min(c + 1, len - 1) : Math.max(c - 1, 0)));
        return true;
      }
      if (e.key === "Enter") {
        if (open === null) {
          const row = rows[cursor];
          if (!row) return false;
          e.preventDefault();
          onOpenPage?.(row.id);
          setOpenId(row.id);
          return true;
        }
        const option = choices[cursor];
        if (!option) return false;
        e.preventDefault();
        open.pick(option.v);
        back();
        return true;
      }
      return false;
    });
  });

  if (open === null) {
    return (
      <div className="panel-settings mini-cc-settings">
        {rows.map((p, i) => (
          <SettingRow
            key={p.id}
            page={p}
            cursor={i === cursor}
            onOpen={() => {
              onOpenPage?.(p.id);
              setOpenId(p.id);
            }}
          />
        ))}
      </div>
    );
  }
  return (
    <>
      <MiniChoicePage
        sections={open.sections}
        value={open.valueId}
        cursor={cursor}
        onPick={(v) => {
          open.pick(v);
          back();
        }}
      />
    </>
  );
}

/** 草稿脸：权限写引擎 permission 命名空间的 defaultPreset（新会话的初始权限）。 */
function DraftSettings(props: ShellProps) {
  const store = useStore();
  const { face, reloadModels } = useDraftModelFace();
  const { describe, update } = useSettingNamespace("permission");
  const [permission, setPermission] = useState<PermissionSettingsView | null>(null);
  const busy = useBusyEnter();
  useEffect(() => {
    void (async () => {
      try {
        setPermission(permissionPresetView(await describe()));
      } catch { /* engine booting */ }
    })();
  }, [describe]);
  const savePermission = async (v: string) => {
    setPermission((cur) => (cur ? { ...cur, current: v } : cur));
    try {
      await update({ defaultPreset: v });
    } catch (err) {
      saveFailed(err);
    }
  };
  const permissionOptions = permission === null ? [] : presetDropdownOptions(permission.options, tRaw);
  const pages: SettingsPage[] = [
    modelPage(face),
    ...((face.effortLevels?.length ?? 0) > 0 ? [effortPage(face, comboFor("cycle-effort", store.keybinds))] : []),
    ...(permission === null ? [] : [{
      id: "permission",
      icon: presetIcon(permission.current),
      label: tRaw("权限"),
      hint: tRaw("新建会话的初始权限。"),
      value: permissionOptions.find((o) => o.v === permission.current)?.label ?? permission.current,
      valueId: permission.current,
      sections: [{ key: "permission", options: permissionOptions.map((o) => ({ v: o.v, label: o.label })) }],
      pick: (v: string) => void savePermission(v),
    }]),
    busyPage(busy),
  ];
  return (
    <SettingsShell
      {...props}
      pages={pages}
      // 目录每次开模型页都重拉（与 HeroPanel 同一条：启动期目录可能是空的，只在挂载时拉
      // 一次会永久留空，表现为"点模型行没反应"）。
      onOpenPage={(id) => { if (id === "model") reloadModels(); }}
    />
  );
}

/** 会话脸：权限走投影视图 + `/permission` 命令；会话模式走 agentPresets/select。 */
function SessionSettings({ sessionId, ...props }: ShellProps & { sessionId: string }) {
  const store = useStore();
  const face = useSessionModels(sessionId);
  const summary = store.sessions.find((s) => s.sessionId === sessionId);
  const select = (summary?.projections?.values as { permissions?: PermissionSelect } | undefined)?.permissions ?? null;
  /** 本地乐观值只用于点击后立刻反映；投影推进后以投影为准（与设置卡同口径）。 */
  const [picked, setPicked] = useState<string | null>(null);
  const busy = useBusyEnter();
  const permission = picked ?? select?.currentValue ?? "";
  const permissionOptions = select === null ? [] : presetDropdownOptions(select.options, tRaw);

  const modeOptions = visibleAgentPresets(store.presets).map((p) => ({ v: p.id, label: agentPresetLabel(p) }));
  const pinned = modeOverrides.get(sessionId) ?? summary?.agentPreset ?? "";
  // 当前会话 pin 的模式不在开放清单（用户自建预设）也照实列出，别让行值显示成空
  const modeList = pinned && !modeOptions.some((o) => o.v === pinned)
    ? [{ v: pinned, label: pinned }, ...modeOptions]
    : modeOptions;

  const pages: SettingsPage[] = [
    modelPage(face),
    ...((face.effortLevels?.length ?? 0) > 0 ? [effortPage(face, comboFor("cycle-effort", store.keybinds))] : []),
    ...(select === null ? [] : [{
      id: "permission",
      icon: presetIcon(permission),
      label: tRaw("权限"),
      value: permissionOptions.find((o) => o.v === permission)?.label ?? permission,
      valueId: permission,
      sections: [{ key: "permission", options: permissionOptions.map((o) => ({ v: o.v, label: o.label })) }],
      pick: (v: string) => {
        // 引擎只有命令这一条写路；失败（会话不在跑/引擎忙）由投影纠偏，不静默兜底
        setPicked(v);
        void api.commandExecute({ agentId: sessionId, line: `/permission ${v}` }).catch(() => undefined);
      },
    }]),
    ...(modeList.length === 0 ? [] : [{
      id: "mode",
      icon: Bot,
      label: tRaw("会话模式"),
      value: modeList.find((o) => o.v === pinned)?.label ?? pinned,
      valueId: pinned || undefined,
      sections: [{ key: "mode", options: modeList }],
      pick: (v: string) => {
        modeOverrides.set(sessionId, v);
        void api.agentPresetSelect({ agentId: sessionId, agentPreset: v }).catch((err) => {
          modeOverrides.delete(sessionId);
          void alertDialog({ message: tt("切换失败：{m}", "Switch failed: {m}", { m: (err as Error).message }) });
        });
      },
    }]),
    busyPage(busy),
  ];
  return <SettingsShell {...props} pages={pages} />;
}

/** 设置模式入口：按有没有活动会话交给对应那一支（两支各自调自己的 hook，不条件调 hook）。 */
export function MiniSettingsRows({ sessionId, ...props }: ShellProps & { sessionId: string | null }) {
  return sessionId === null
    ? <DraftSettings {...props} />
    : <SessionSettings sessionId={sessionId} {...props} />;
}
