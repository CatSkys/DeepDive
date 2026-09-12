// 会话里创建自动化的协议（DeepDive 自定，契约见 SPEC-AUTOMATION §5）：模型在回复
// 里输出一个 info string 为 `automation` 的围栏代码块，内容是一段 JSON；SPA 在消息
// 流里把它渲染成一张建议卡，点「创建定时任务」带着解析结果进新建表单——用户过一眼
// 才落库，不静默创建。格式由壳写进引擎的 system-prompt（EngineSupervisor），
// 所以本文件里的形状与那段提示词是同一份契约，改一处必须同步另一处。

import { isSchedule, type Schedule } from "./model";

/** 围栏代码块的 info string（```automation）。 */
export const PROPOSAL_LANG = "automation";

export interface AutomationProposal {
  title: string;
  instruction: string;
  schedule: Schedule;
  /** 目标工作空间标题；null = 用当前活动空间（用户在表单里仍可改）。 */
  workspace: string | null;
  /** 引擎权限预设键；null = 跟随会话默认。 */
  permission: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** 解析建议块；形状不合（模型没按格式写 / 手改成坏 JSON）返回 null——
 *  调用方退回普通代码块渲染，不当成错误。 */
export function parseProposal(text: string): AutomationProposal | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return null; // 不是 JSON：按普通代码块处理
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const title = str(o.title);
  const instruction = str(o.instruction);
  if (title === null || instruction === null || !isSchedule(o.schedule)) return null;
  return {
    title,
    instruction,
    schedule: o.schedule,
    workspace: str(o.workspace),
    permission: str(o.permission),
  };
}
