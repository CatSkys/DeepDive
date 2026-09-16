// 会话协作分区的纯逻辑：外部 agent 联系人的**边界校验**与命令行拼装。
//
// 联系人存在 localStorage（客户端偏好），那是个外部输入边界：读到什么形状都要逐条收窄，
// 坏数据整条丢掉——不做"尽量修一修"，也不给缺失字段补默认值（PITFALLS §4.15 同源纪律：
// 结构不符预期就别猜）。

export interface AgentContact {
  /** 稳定 id（列表 key 与删除目标）。 */
  id: string;
  name: string;
  /** 绝对路径，或裸命令名（壳经 /usr/bin/env 解析 PATH）。 */
  command: string;
  /** 固定前缀参数；用户消息永远追加在最后。 */
  args: string[];
}

export const AGENTS_KEY = "deepdive.collabAgents";

/** localStorage 原文 → 联系人列表；坏 JSON、非数组、缺关键字段的行一律丢。 */
export function parseAgentContacts(raw: string | null): AgentContact[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const out: AgentContact[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const command = typeof row.command === "string" ? row.command.trim() : "";
    const args = Array.isArray(row.args) ? row.args.filter((a): a is string => typeof a === "string") : [];
    if (!id || !name || !command) continue;
    out.push({ id, name, command, args });
  }
  return out;
}

/** 用户消息始终是**最后一个参数**（`claude -p "<msg>"` 这类一次性调用形态）。
 *  空白消息不发：只跑固定参数是没有意义的调用。 */
export function agentArgv(contact: AgentContact, message: string): string[] | null {
  const text = message.trim();
  if (!text) return null;
  return [...contact.args, text];
}
