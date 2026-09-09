// 整行斜杠命令裁决（官方 ui-commands matchEnter 的最小移植）：trim 后整行
// 形如 "/name [args…]" 才进命令通道；斜杠只出现在文中、或名字不合法（如
// 路径 "/foo.txt"）一律回落 prompt（null）。未知名字返回 unknown——官方语义
// 是拒绝提交并保留草稿（不静默发给模型）。

import type { CommandDescriptor } from "./types";

export type SlashLineDecision =
  | { kind: "command"; command: CommandDescriptor; line: string }
  | { kind: "unknown"; name: string }
  | null;

export function adjudicateSlashLine(text: string, commands: CommandDescriptor[]): SlashLineDecision {
  const trimmed = text.trim();
  const match = /^\/([a-z][a-z0-9_-]*)(?:$|\s[\s\S]*$)/.exec(trimmed);
  if (!match) return null;
  const cmd = commands.find((c) => c.name === match[1]);
  return cmd ? { kind: "command", command: cmd, line: trimmed } : { kind: "unknown", name: match[1] };
}
