// 审批设置数据层（设置页「审批」分区专用）：引擎 permission 命名空间的
// defaultPreset 是"新会话的初始权限预设"（interaction/permission-presets，
// session/created 时 pin）。选项不在 namespace 载荷里，而在其 schema 的
// compact refs 编码中：root.object.dict.defaultPreset → union.list →
// const 节点（实测 0.1.1-rc.2，写回走与 ui-conversation 同款 settingsUpdate）。

export interface PermissionPresetOption {
  /** 预设键（写入值，如 workspace-write）。 */
  value: string;
  /** 引擎 schema description 优先，缺省展示预设键本身。 */
  label: string;
}

export interface PermissionSettingsView {
  current: string;
  options: PermissionPresetOption[];
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

/** 从 settings.describe 的 permission 条目解析默认预设与可选枚举；
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
    const desc = node.meta?.description;
    return [{ value: node.value, label: typeof desc === "string" && desc ? desc : node.value }];
  });
  if (!options.some((o) => o.value === current)) return null;
  return { current, options };
}
