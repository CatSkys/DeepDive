// 权限预设的共享数据层：引擎 permission 命名空间的省缺值枚举（设置页「审批」
// 分区、新建项目表单、自动化任务编辑器）与会话投影 permissions 的视图（右侧
// 边栏会话设置）都从这里取——选项形状、本地化标签、下拉项映射同一份。
// 管什么：预设键 → 选项/标签/说明/图标；不管什么：读写通道（各自走 api）。
//
// 选项形状与引擎 PresetOption 同构（permission-presets/types.ts）：name 是
// 展示名、description 是说明，都允许缺省（缺省时回退预设键 / 不显示说明）。

import { ShieldAlert, ShieldCheck, SquarePen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DropdownOption } from "../components/controls";

/** 一个权限预设的展示选项（引擎 permission-presets 的选项形状）。 */
export interface PresetOption {
  /** 预设键（写入值，如 workspace-write）。 */
  value: string;
  /** 展示名；引擎未配置 name 时回退预设键。 */
  name: string;
  /** 一句话说明；引擎未配置时省略（下拉行退回单行）。 */
  description?: string;
}

/** 会话投影 permissions 的 wire 视图（SessionView → 右侧边栏会话设置）。 */
export interface PermissionSelect {
  options: PresetOption[];
  currentValue: string;
}

/** 新会话默认预设的 settings 视图（permission.defaultPreset）。 */
export interface PermissionSettingsView {
  current: string;
  options: PresetOption[];
}

/** 已知预设的本地化标签/说明/图标（UI 参考官方权限菜单）；未知预设（含引擎
 *  derived 的 custom）退回引擎原文。label/desc 是 i18n 源串，用点处经 t()。 */
const PRESET_META: Record<string, { label: string; desc: string; icon: LucideIcon; danger?: boolean }> = {
  "read-only": { label: "只读", desc: "只读取与分析，不改文件。", icon: ShieldCheck },
  "workspace-write": { label: "工作区写入", desc: "工作区内自动改文件，越界先确认。", icon: SquarePen },
  "danger-full-access": { label: "完全访问", desc: "全部可写，不再逐步确认。", icon: ShieldAlert, danger: true },
};

/** 预设选项 → 下拉项：已知预设走本地化标签/说明/图标，未知预设用引擎原文。 */
export function presetDropdownOptions(options: PresetOption[], t: (s: string) => string): DropdownOption[] {
  return options.map((o) => {
    const meta = PRESET_META[o.value];
    return {
      v: o.value,
      label: meta ? t(meta.label) : o.name,
      description: meta ? t(meta.desc) : o.description,
      icon: meta?.icon,
      danger: meta?.danger,
    };
  });
}

interface SchemaRefs {
  [id: string]: {
    type?: string;
    value?: unknown;
    meta?: { description?: unknown };
    list?: unknown[];
    dict?: Record<string, unknown>;
  };
}

/** 从 settings.describe 的 permission 条目解析默认预设与可选枚举；选项名取自
 *  枚举节点的 schema description（引擎把预设的 name 写在那里）。
 *  形状不合（引擎未装 permission-presets / 升级变更）返回 null。 */
export function permissionPresetView(entry: {
  schema?: unknown;
  value?: unknown;
} | undefined): PermissionSettingsView | null {
  if (!entry) return null;
  const current = (entry.value as { defaultPreset?: unknown } | null)?.defaultPreset;
  if (typeof current !== "string") return null;
  const schema = entry.schema as { uid?: unknown; refs?: SchemaRefs } | undefined;
  const refs = schema?.refs;
  const root = refs?.[String(schema?.uid)];
  const unionId = root?.dict?.defaultPreset;
  const union = unionId !== undefined ? refs?.[String(unionId)] : undefined;
  const list = union?.type === "union" && Array.isArray(union.list) ? union.list : [];
  const options = list.flatMap((id) => {
    const node = refs?.[String(id)];
    if (node?.type !== "const" || typeof node.value !== "string") return [];
    const name = node.meta?.description;
    return [{ value: node.value, name: typeof name === "string" && name ? name : node.value }];
  });
  if (!options.some((o) => o.value === current)) return null;
  return { current, options };
}
