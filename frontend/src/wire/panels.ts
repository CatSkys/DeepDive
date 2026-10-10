// wire v1 契约 · 交互挂起态与面板数据（docs/WIRE-V1.md §2/§5）：审批/提问的
// waterfall 载荷、排队与 prompt 部件、命令目录/执行、任务/子代理/目标/git 等
// 面板数据面。事件流词表在 ./sessionEvents，信封身份在 ./v1。

/** 挂起审批（waterfall `approval/request`；request = {toolName, callId?, reason?}）。 */
export interface ApprovalPending {
  eventId: string;
  sessionId: string;
  toolName: string;
  callId?: string;
  reason?: string;
}

/** 挂起提问（waterfall `user-questions/request`；questions 首条带提问文本）。 */
export interface QuestionPending {
  eventId: string;
  sessionId: string;
  questions: QuestionItem[];
}

/* ── 用户提问（ask_user_question）线路契约 ──
   以 $events waterfall（`user-questions/request`）推送，应答按 eventId
   经 $events/result 回 {answers:[{id, selected, custom?}]}。 */

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionItem {
  id: string;
  question: string;
  header?: string;
  detail?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
  intent?: { kind: "plan-review"; approve: string };
}

export interface QuestionAnswerItem {
  id: string;
  selected: string[];
  custom?: string;
}

/* ── 排队消息（pending inbox）线路契约 ──
   队列快照走 session/control 流（每变化一次全量 items）；操作走
   session/updateQueue unary：{sessionId, itemId, action}，action = edit
   （仅文本）/ remove / steer（=立即插队）。 */

export interface SessionQueuedItem {
  id: string;
  placement: "queued" | "steering" | "context";
  /** 排队消息 user source 上的 Prompt-RPC 身份。 */
  rpcId?: string;
  message: {
    id: string;
    content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  };
}

/* ── session.prompt 的 content 分块（文本在前、图像附件在后）── */

export type PromptContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string; name?: string }
  /** 通用文件部件：引用 uploadFile 回执（随 requestId 生命周期退役）。 */
  | { type: "file"; receiptId: string };

/** commands/list 条目（引擎 CommandDescriptor，name 排序）。 */
export interface CommandDescriptor {
  /** 无斜杠小写命令名。 */
  name: string;
  description: string;
  /** 存在即表示命令吃自由输入：hint 是占位提示；attachments=true 才收附件。 */
  input?: { hint: string; attachments?: boolean };
}

/** commands/execute 的附件部件：图片直传字节、通用文件走已落盘的 receiptId。 */
export type CommandSubmitAttachment =
  | { type: "image"; mediaType: string; data: string; name?: string }
  | { type: "file"; receiptId: string };

/**
 * commands/execute 回包（undefined = 未知/畸形命令，引擎不落任何事件）。
 * 转录节点来自 command/run + command/done 会话事件（按 commandId 配对），
 * 回包只用于提交侧的成败裁决。
 */
export interface CommandExecution {
  commandId: string;
  result: { kind: "success"; text?: string; sourceEventSeq?: number } | { kind: "error"; text: string };
}

/** session/control jobs 帧的单条后台任务视图。 */
export interface JobView {
  id: string;
  kind: string;
  label: string;
  status: "running" | "stopping" | "completed" | "killed" | "failed";
  detail?: string;
  startedAt: number;
  finishedAt?: number;
}

/** 壳层 run-git 的聚合回包（工作区未提交改动；非 git 仓库 repo=false）。 */
export interface GitStatus {
  repo: boolean;
  branch?: string;
  files: number;
  additions: number;
  deletions: number;
}

/** subagents/list 的单条目（谱系树；diagnostic 为坏账行）。 */
export type SubagentListEntry =
  | {
    kind: "child";
    id: string;
    activity: "running" | "inactive";
    hasChildren: boolean;
    mode: "one-shot" | "continuable";
    label?: string;
  }
  | { kind: "diagnostic"; id: string; reason: "corrupt" | "unsupported" | "unavailable" };

/** goal 投影值（goal/change 全值 last-wins；CAS 修订在其 goal.revision 上）。
 *  消费者：右栏状态面板的目标区（CapsuleGoalSection）。 */
export interface GoalProjection {
  goal: {
    id: string;
    revision: number;
    objective: string;
    phase: "active" | "paused" | "blocked" | "complete";
    blockedReason?: { code: string; message: string };
    maxGoalRounds: number;
  };
  roundsStarted: number;
  createdAt: number;
  updatedAt: number;
}
