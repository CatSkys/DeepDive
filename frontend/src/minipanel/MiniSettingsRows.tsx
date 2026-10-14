// 命令中心的**设置模式**：根行（图标 + 动作名 + 快捷键）+ **卡内翻页**——点一行翻到那一页
// 的选项列表，选中即写回并退回根行（用户 2026-10-13 定稿："模型页面相当于一个单独的页面，
// 是在命令中心里面进行跳转的"；不再弹主窗那套模型菜单 / 下拉）。
// **根行只说"做什么"，不说"现在是什么"**（用户 2026-10-14 给 Raycast 动作面板参考：
// "严格参考这个，不要把模型名字和其他内容直接放出来"）：所以标签是动作措辞（"更换模型"），
// 行上既没有当前值也没有 ›，值只在翻进去那一页上以打勾表示——`SettingsPage.value` 因此删了。
//
// 按当前脸给行集——草稿脸：模型 / 思考强度 / 权限（新会话的初始权限）/ 发送方式；
// 会话脸：模型 / 思考强度 / 权限（当前会话）/ 会话模式 / 发送方式。
// 写入路径全是既有那些（useDraftModelFace / useSessionModels / useSettingNamespace 的
// permission·conversation 命名空间 / agentPresets+select / `/permission` 命令），
// 与 HeroPanel、SessionSettings 同源，不是第二份实现。选择页本身只有 MiniChoicePage 一个件。
// 「插件」不进面板：主窗设置页的事（面板求简洁）。
import { useEffect, useState } from "react";
import { Bot, CircleAlert, Cpu, Gauge, History, Pin, Send, Settings, SquarePen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "../api";
import { t as tRaw, tt } from "../i18n";
import { alertDialog } from "../components/DialogHost";
import { modelKey, modelSections } from "../components/ModelMenu";
import { shownLevel } from "../components/composer/EffortPicker";
import { agentPresetLabel, visibleAgentPresets } from "../settings/agentPreset";
import {
  permissionPresetView, presetDropdownOptions, presetIcon,
  type PermissionSelect, type PermissionSettingsView,
} from "../settings/permissionPreset";
import { comboFor } from "../keybinds";
import { SettingsConflictError, useSettingNamespace } from "../settings/useSettingNamespace";
import { useStore } from "../store";
import { sendToShell } from "../host";
import { useSessionModels } from "../session/useSessionModels";
import { modeOverrides } from "../sidebar-right/SessionSettings";
import { useDraftModelFace } from "../useDraftModelFace";
import { MiniChoicePage, flattenChoices, type ChoiceSection } from "./MiniChoicePage";
import { ROW_ICON } from "../components/panelRowIcon";
import type { RegisterKeys } from "./MiniCommandCenter";
import type { ModelFace } from "../session/SessionHeader";

/** 一页设置：翻页后的选项集 + 写回。根行那半（图标 / 名称 / 快捷键）就是 `CardRow` 的入参。 */
interface SettingsPage {
  id: string;
  /** 根行左侧的图标（与主窗命令面板的行同一套解剖：icon + 名称 + 快捷键）。 */
  icon: LucideIcon;
  /** 根行的标签，写成**动作**（"更换模型"）：行上不显示当前值，所以名称必须自己说清点了会怎样。 */
  label: string;
  /** 这一页对应的全局快捷键（有就画成键帽，与命令面板同一套 `.tip-key`）；没有就空着。 */
  combo?: string;
  /** 选项里打勾的那条（`ChoiceOption.v`）——当前值只在这里露出来。 */
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
    label: tRaw("更换发送方式"),
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
    label: tRaw("更换模型"),
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
    label: tRaw("更换思考强度"),
    valueId: id,
    sections: [{ key: "effort", options: levels.map((l) => ({ v: l.id, label: l.name })) }],
    pick: (v) => void face.pickEffort?.(v),
  };
}

/** 命令中心里的**动作行**（用户 2026-10-14："新建会话、会话历史、会话置顶、打开设置……
 *  这些都可以加到命令中心里面"）：形态与设置行同一副解剖（图标 + 名称 + 快捷键），差别只在
 *  "点了就执行"而不是"翻页"——所以右边没有当前值、也没有 ›。
 *  动作**不在卡片页执行**：卡片是另一块 webview、另一份 store，它执行只会改一份不渲染的
 *  store（`mini-cc-open-session` 那条踩过）。一律 `sendToShell` 报给壳，由壳转回面板页
 *  （新建/切脸/置顶）或主窗（打开设置）——见 QuickPanelController 的 `mini-cc-action` 分支。 */
interface ActionRow {
  id: string;
  icon: LucideIcon;
  label: string;
  combo?: string;
  run: () => void;
}

const cardAction = (action: string, sessionId?: string) =>
  sendToShell(sessionId === undefined
    ? { type: "mini-cc-action", action }
    : { type: "mini-cc-action", action, sessionId });

/** 两脸共用的动作行集（草稿脸没有会话 → 不出现"置顶"那一行）。 */
function useCardActions(sessionId: string | null): ActionRow[] {
  const store = useStore();
  return [
    {
      id: "new-session", icon: SquarePen, label: tRaw("新建会话"),
      combo: comboFor("new-session", store.keybinds),
      run: () => cardAction("new-session"),
    },
    { id: "history", icon: History, label: tRaw("会话历史"), run: () => cardAction("history") },
    ...(sessionId === null ? [] : [{
      id: "pin", icon: Pin,
      label: store.pinned.has(sessionId) ? tRaw("取消置顶") : tRaw("置顶"),
      run: () => cardAction("toggle-pin", sessionId),
    }]),
    {
      id: "open-settings", icon: Settings, label: tRaw("打开设置"),
      combo: comboFor("open-settings", store.keybinds),
      run: () => cardAction("open-settings"),
    },
  ];
}

/** 根层的一行：动作行与设置行是**同一副解剖**（图标 + 名称 + 快捷键芯片），差别只有"点了就走"
 *  与"点了翻页"，所以共用这一个件（此前 ActionLine / SettingRow 两份是同一段 JSX 抄了两遍）。
 *  右端**只有芯片**，没有当前值也没有 ›（用户 2026-10-14 给 Raycast 动作面板参考："严格参考
 *  这个，不要把模型名字和其他内容直接放出来"）——当前值翻进去看，那一页里用打勾表示。
 *  `opens` = 这一点会开卡内下一页：按参考面板的口径在名称后加「…」（"Change Model…"），
 *  直接执行或换到别的界面的行没有它（"Open AI Settings" 也没有）。省略号是**行种类的渲染
 *  约定**、不是文案的一部分，所以不进 i18n 词条。
 *  cursor = 键盘光标（↑↓ 走到这一行）：与历史行同一档填充（hover 5% / 光标 10%），
 *  没有它就看不出回车会开哪一行。 */
function CardRow({
  icon: Icon, label, combo, hint, opens = false, cursor, onClick,
}: {
  icon: LucideIcon;
  label: string;
  combo?: string;
  hint?: string;
  opens?: boolean;
  cursor: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="panel-settings-line panel-settings-row"
      data-cursor={cursor || undefined}
      onClick={onClick}
    >
      {/* 行图标与 ⌘K 面板同一份参数（块注释在 `components/panelRowIcon.ts`）：参考面板的图标是
          16 格里 1.5 描边，lucide 默认是 24 格里 2、渲到 15px 只剩 1.25。 */}
      <span className="panel-settings-icon"><Icon {...ROW_ICON} /></span>
      <span className="panel-settings-label">
        {opens ? `${label}…` : label}
        {hint !== undefined && <CircleAlert size={12} className="panel-settings-hint-icon" data-tip={hint} />}
      </span>
      {combo !== undefined && (
        <span className="tip-keys-row outline">
          {[...combo].map((ch, i) => <kbd key={i} className="tip-key">{ch}</kbd>)}
        </span>
      )}
    </button>
  );
}

interface ShellProps {
  registerKeys: RegisterKeys;
  /** 搜索词（两个脸共用卡片顶上那条搜索；空的 = 不过滤）。 */
  query: string;
}

/** 设置模式的壳：根行 ↔ 选择页的翻页、搜索过滤与键盘，两脸共用（只喂 pages）。 */
function SettingsShell({
  pages,
  actions,
  query,
  registerKeys,
  onOpenPage,
}: ShellProps & {
  pages: SettingsPage[];
  /** 命令中心顶部那组动作行（「操作」在前、「设置」类在后，同一副行解剖）。 */
  actions: ActionRow[];
  /** 打开某页时的钩子（草稿脸的模型页借它重拉目录）。 */
  onOpenPage?: (id: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  // 页可能因取数未到而缺席（如权限投影还没来）：找不到就按根行处理，不留半张空页
  const open = pages.find((p) => p.id === openId) ?? null;
  // 设置脸没有搜索框（用户 2026-10-13 定稿："它就是一块设置页面"），所以行集与选项都不再过滤
  const rows = pages;
  // 搜索（用户 2026-10-14："上面还要加个搜索"）：根层按名称过滤，翻页后的选项同一把尺子。
  const q = query.trim().toLowerCase();
  const hit = (s: string) => q === "" || s.toLowerCase().includes(q);
  const visibleSections = open === null ? [] : open.sections
    .map((s) => ({ ...s, options: s.options.filter((o) => hit(o.label)) }))
    .filter((s) => s.options.length > 0);
  // 根层的键盘序 = 动作行 + 设置行（一条连续的光标序，↑↓/回车一视同仁）
  const root = [
    ...actions.filter((a) => hit(a.label)).map((action) => ({ kind: "action" as const, action })),
    ...rows.filter((p) => hit(p.label)).map((page) => ({ kind: "page" as const, page })),
  ];
  const choices = open === null ? [] : flattenChoices(visibleSections);

  useEffect(() => { setCursor(0); }, [openId, query]);

  const back = () => setOpenId(null);

  // 每渲染重注册一份最新的（处理器闭包要拿当下的 open/cursor）；返回的注销交给 effect 清理。
  useEffect(() => registerKeys((e) => {
      if (e.key === "Escape" && open !== null) {
        back();
        return true;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const len = open === null ? root.length : choices.length;
        if (len === 0) return true;
        e.preventDefault();
        setCursor((c) => (e.key === "ArrowDown" ? Math.min(c + 1, len - 1) : Math.max(c - 1, 0)));
        return true;
      }
      if (e.key === "Enter") {
        if (open === null) {
          const entry = root[cursor];
          if (!entry) return false;
          e.preventDefault();
          if (entry.kind === "action") {
            entry.action.run();
            return true;
          }
          onOpenPage?.(entry.page.id);
          setOpenId(entry.page.id);
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
    }));

  if (open === null) {
    return (
      <div className="panel-settings mini-cc-settings">
        {root.map((entry, i) => (entry.kind === "action"
          ? (
            <CardRow
              key={entry.action.id}
              icon={entry.action.icon}
              label={entry.action.label}
              combo={entry.action.combo}
              cursor={i === cursor}
              onClick={entry.action.run}
            />
          )
          : (
            <CardRow
              key={entry.page.id}
              icon={entry.page.icon}
              label={entry.page.label}
              combo={entry.page.combo}
              hint={entry.page.hint}
              opens
              cursor={i === cursor}
              onClick={() => {
                onOpenPage?.(entry.page.id);
                setOpenId(entry.page.id);
              }}
            />
          )))}
        {root.length === 0 && <p className="mini-cc-empty">{tRaw("没有匹配的命令")}</p>}
      </div>
    );
  }
  return (
    <>
      <MiniChoicePage
        sections={visibleSections}
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
      label: tRaw("更换权限"),
      hint: tRaw("新建会话的初始权限。"),
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
      actions={useCardActions(null)}
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
      label: tRaw("更换权限"),
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
      label: tRaw("更换会话模式"),
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
  return <SettingsShell {...props} pages={pages} actions={useCardActions(sessionId)} />;
}

/** 设置模式入口：按有没有活动会话交给对应那一支（两支各自调自己的 hook，不条件调 hook）。 */
export function MiniSettingsRows({ sessionId, ...props }: ShellProps & { sessionId: string | null }) {
  return sessionId === null
    ? <DraftSettings {...props} />
    : <SessionSettings sessionId={sessionId} {...props} />;
}
