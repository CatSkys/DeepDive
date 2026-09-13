// 到点执行一个任务：拿到一个会话（复用传入的，或新开一个），按任务配置选模型与
// 权限，再发一条指令。引擎在本引脚没有定时任务面（SPEC-AUTOMATION §1），所以由
// 客户端调度器驱动。失败不抛：以 { error } 交调用方记进运行历史——无人值守时
// 错误必须留痕。

import { api } from "../api";
import { automationRunTitle } from "../session/backgroundSession";
import type { AutomationTask } from "./model";
import { uuid } from "../uuid";

/** reused = 这次是复用既有会话（调用方据此决定要不要把新会话记回任务）。 */
export type RunOutcome = { sessionId: string; reused: boolean } | { error: string };

export async function startRun(task: AutomationTask, reuse: string | null): Promise<RunOutcome> {
  try {
    const sessionId = reuse ?? (await api.createSession(task.workspaceId === null ? {} : { workspaceId: task.workspaceId })).sessionId;
    if (reuse === null) {
      // 命名即判据：自动化的运行会话是后台会话，不进用户列表（运行历史里仍可打开）。
      await api.sessionRename({ sessionId, title: automationRunTitle(task.title) })
        .catch(() => { /* 改名失败只影响列表呈现，不影响本次运行 */ });
    }
    if (task.model !== null) await api.selectModel({ sessionId, ...task.model });
    if (task.permission !== null) {
      // 权限只能经 /permission 命令写（api.selectModel 那类 RPC 没有这一面）；
      // agentId 对新会话即 sessionId（Composer 的斜杠路径同款）。
      const res = await api.commandExecute({ agentId: sessionId, line: `/permission ${task.permission}` });
      if (res?.result.kind === "error") throw new Error(res.result.text);
    }
    await api.prompt({
      requestId: uuid(),
      sessionId,
      mode: "queue",
      content: [{ type: "text", text: task.instruction }],
    });
    return { sessionId, reused: reuse !== null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
