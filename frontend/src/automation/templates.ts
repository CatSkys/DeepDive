// 定时任务模板：列表页下半区那四张卡。中文即词典键（i18n-en.ts 同键收录），
// 点一张只是把示例填进新建表单，不直接创建任务。指令里带「只读分析」是为了
// 无人值守时不出意外写入——模板给的是保守起点，用户可改。

import { Activity, FileDiff, FileText, Sunrise, type LucideIcon } from "lucide-react";
import type { Schedule } from "./model";

export interface TaskTemplate {
  id: string;
  /** 卡片标题左侧的小图标（参考图形制）。 */
  icon: LucideIcon;
  name: string;
  description: string;
  instruction: string;
  schedule: Schedule;
}

export const TEMPLATES: readonly TaskTemplate[] = [
  {
    id: "standup",
    icon: Sunrise,
    name: "晨会动态",
    description: "汇总上一个工作日以来的提交、模块变化、CI 状态和待跟进事项，最终生成不超过 6 条的晨会口述摘要。",
    instruction: "汇总上一个工作日以来的提交、模块变化与待跟进事项，生成不超过 6 条的晨会摘要。只读分析：不要修改文件、不要提交，结尾列出待跟进事项。",
    schedule: { kind: "weekdays", hour: 9, minute: 0 },
  },
  {
    id: "risk",
    icon: Activity,
    name: "风险扫描",
    description: "检查最近 24 小时的代码变更，识别运行错误、数据丢失、权限绕过、资源泄漏及跨端兼容等高危风险。",
    instruction: "检查最近 24 小时的代码变更，识别运行错误、数据丢失、权限绕过、资源泄漏与跨端兼容等高危风险，逐条附文件路径与行号并给出修复建议。只读分析。",
    schedule: { kind: "daily", hour: 10, minute: 0 },
  },
  {
    id: "release",
    icon: FileText,
    name: "发布简报",
    description: "整理本周合并的 PR 和 commit，按功能、修复、体验及工程改进分类，同时生成团队版和面向用户的精简发布说明。",
    instruction: "整理本周合并的 PR 和 commit，按功能、修复、体验与工程改进分类，生成团队版与面向用户的精简发布说明两份。只读分析。",
    schedule: { kind: "weekly", weekday: 5, hour: 16, minute: 0 },
  },
  {
    id: "docs",
    icon: FileDiff,
    name: "文档同步检查",
    description: "对照最近 7 天的代码、配置、接口与文档变更，识别已改变公开行为但文档尚未同步的高危差异。",
    instruction: "对照最近 7 天的代码、配置、接口与文档变更，找出已改变公开行为但文档尚未同步的高危差异，附文件路径与原文位置。只读分析。",
    schedule: { kind: "weekly", weekday: 3, hour: 15, minute: 0 },
  },
];
