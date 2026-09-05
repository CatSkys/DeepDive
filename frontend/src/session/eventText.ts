// 事件载荷 → 纯文本的提取层（isTextBlock/messageText/userText/textOf/blocksOf）。
// 管事件文本语义，不管渲染与摄取装配；renderModel 与 SessionView 组件群共用。
import type { AssistantMessageData, ContentBlock, ReasoningBlock, SessionEvent, TextBlock, UserMessageData } from "../types";

export function isTextBlock(b: ContentBlock | undefined): b is TextBlock {
  return !!b && (b as TextBlock).type === "text" && typeof (b as TextBlock).text === "string";
}

/// Plain text of an assistant/user message (text blocks only, never reasoning).
export function messageText(content: ContentBlock[] | undefined): string {
  if (!Array.isArray(content)) return "";
  return content.filter(isTextBlock).map((b) => (b as TextBlock).text).join("");
}

/// Reasoning (think) text of an assistant message; null when absent.
function messageReasoning(content: ContentBlock[] | undefined): string | null {
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const b of content) {
    if (b && (b as ReasoningBlock).type === "reasoning" && typeof (b as ReasoningBlock).text === "string" && (b as ReasoningBlock).text) {
      parts.push((b as ReasoningBlock).text);
    }
  }
  return parts.length ? parts.join("\n\n") : null;
}

/// Text of a user/message event, honoring its `source.kind` (only real user
/// input is chat content; injected plugin/skill-catalog context is not).
export function userText(d: UserMessageData): string {
  const kind = (d.source as { kind?: string })?.kind;
  if (kind !== "user" && kind !== undefined) return "";
  return messageText(d.content);
}

export function textOf(event?: SessionEvent): string {
  if (!event) return "";
  switch (event.type) {
    case "user/message": return userText(event.data as UserMessageData);
    case "assistant/message": return messageText((event.data as AssistantMessageData).message?.content);
    default: return "";
  }
}

/// Text + reasoning split for an assistant message (render-time, from the
/// final event). Folds reasoning into the same assistant container (official
/// AssistantMarkdown) so it is never a separate duplicate row.
export function blocksOf(event?: SessionEvent): { text: string; think: string | null } {
  if (!event) return { text: "", think: null };
  const content = event.type === "assistant/message" ? (event.data as AssistantMessageData).message?.content : undefined;
  return { text: messageText(content), think: messageReasoning(content) };
}
