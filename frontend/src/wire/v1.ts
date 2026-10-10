// wire v1 契约 · 信封与身份面（M0，docs/WIRE-V1.md）：DeepDive 自有 wire 的
// 版本常量与 unary/流共用的身份类型。演进规则：v1 内只增不改；破坏性变更 = v2。
// dsh 引擎（无版本标记）按「实现注记 A」双读，归一化在 ./normalize。

/** 契约版本：unary 响应头 `X-DeepDive-Wire` 与 $events ready 帧 `wireVersion`
 *  上报的就是它。 */
export const WIRE_VERSION = 1;

export interface RpcResult<T = unknown> {
  ok: boolean;
  value?: T;
  error?: { code?: string; message?: string };
}

/** 会话持久地址（session/follow、session/page 共用）：普通会话或 subagent 子址。 */
export type SessionAddress =
  | { kind: "session"; sessionId: string }
  | { kind: "subagent"; parentSessionId: string; childSessionId: string; mode: "one-shot" | "continuable" };

export interface SessionSummary {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  parentSessionId?: string;
  origin?: "subagent";
  cwd?: string;
  agentPreset?: string;
  projections?: { asOfSeq: number; values: Record<string, unknown> };
}

export interface WorkspaceView {
  workspaceId: string;
  path: string;
  title: string;
  sessionIds: string[];
  createdAt: string;
  updatedAt: string;
}
