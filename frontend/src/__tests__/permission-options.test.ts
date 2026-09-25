// 权限预设选项的渲染网眼：引擎的预设表没配 name（wire 上 name 就是裸键
// read-only/workspace-write/danger-full-access），客户端必须把它们映射成正式
// 名称——中文源串与英文词典都要像产品文案，别把裸键漏给用户；未知预设
// （引擎 derived 的 custom）退回引擎原文。@vitest-environment node
import { describe, expect, it } from "vitest";
import { EN } from "../i18n-en";
import { permissionPresetView, presetDropdownOptions, type PresetOption } from "../settings/permissionPreset";

/** 引擎在 presets 表里没写 name/description 时，投影与设置枚举都只给裸键。 */
const ENGINE_OPTIONS: PresetOption[] = [
  { value: "read-only", name: "read-only" },
  { value: "workspace-write", name: "workspace-write" },
  { value: "danger-full-access", name: "danger-full-access" },
];

const en = (s: string) => EN[s] ?? s;

describe("权限预设下拉项", () => {
  it("已知预设走本地化名称，不把裸键摆到界面上", () => {
    expect(presetDropdownOptions(ENGINE_OPTIONS, (s) => s).map((o) => o.label))
      .toEqual(["只读", "工作区写入", "完全访问"]);
    expect(presetDropdownOptions(ENGINE_OPTIONS, en).map((o) => o.label))
      .toEqual(["Read-only", "Workspace writes", "Full access"]);
  });

  it("已知预设带一句话说明（中英各一份）", () => {
    expect(presetDropdownOptions(ENGINE_OPTIONS, (s) => s).map((o) => o.description))
      .toEqual(["只读取与分析，不改文件。", "工作区内自动改文件，越界先确认。", "全部可写，不再逐步确认。"]);
    expect(presetDropdownOptions(ENGINE_OPTIONS, en).map((o) => o.description))
      .toEqual([
        "Read and analyze; no file changes.",
        "Edits inside the workspace run automatically; anything beyond asks first.",
        "Everything writable, without step-by-step approvals.",
      ]);
  });

  it("完全访问是唯一的危险项（触发钮走热点橙）", () => {
    expect(presetDropdownOptions(ENGINE_OPTIONS, en).map((o) => o.danger === true))
      .toEqual([false, false, true]);
  });

  it("未知预设（custom）：用引擎给的名称与说明，不带图标", () => {
    const opts = presetDropdownOptions([{ value: "custom", name: "Custom", description: "Knobs match no preset." }], (s) => s);
    expect(opts).toEqual([{ v: "custom", label: "Custom", description: "Knobs match no preset.", icon: undefined, danger: undefined }]);
  });
});

describe("permissionPresetView", () => {
  /** settings.describe 的 permission 条目：选项在 schema 的 compact refs 里，
   *  枚举名写在 const 节点的 meta.description（引擎 z.const(name).description(label)）。 */
  const entry = {
    value: { defaultPreset: "workspace-write" },
    schema: {
      uid: "root",
      refs: {
        root: { dict: { defaultPreset: "u1" } },
        u1: { type: "union", list: ["c1", "c2"] },
        c1: { type: "const", value: "read-only", meta: { description: "Read-only" } },
        c2: { type: "const", value: "workspace-write" },
      },
    },
  };

  it("枚举名取自枚举节点的 description，缺省回退预设键", () => {
    expect(permissionPresetView(entry)).toEqual({
      current: "workspace-write",
      options: [{ value: "read-only", name: "Read-only" }, { value: "workspace-write", name: "workspace-write" }],
    });
  });

  it("当前值不在枚举里（引擎未装 permission-presets / 形状变更）→ null", () => {
    expect(permissionPresetView({ ...entry, value: { defaultPreset: "custom" } })).toBeNull();
    expect(permissionPresetView(undefined)).toBeNull();
  });
});
