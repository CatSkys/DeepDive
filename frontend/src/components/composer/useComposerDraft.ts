// 草稿持久化 hook：composer 文本按会话（草稿页按工作空间）读写
// localStorage，空稿清除、变更 250ms 防抖落盘。只管草稿键的存取；
// 发送成功后的清除由编排方拿返回的 draftKey 自己做。

import { useEffect, useState } from "react";

/** 草稿键：会话按 sessionId，新会话页（hero）按工作空间。 */
export function draftKeyOf(sessionId: string | null, activeWorkspaceId: string | null): string | null {
  if (sessionId) return `deepdive.draft.${sessionId}`;
  return activeWorkspaceId ? `deepdive.draft.hero.${activeWorkspaceId}` : null;
}

/** 写一条草稿（空串即清除）。「立即试用」这类入口在别处预填时走它，
    保证键与读写规则只有这一份。 */
export function writeDraft(key: string | null, text: string): void {
  if (!key) return;
  if (text) localStorage.setItem(key, text);
  else localStorage.removeItem(key);
}

export function useComposerDraft(sessionId: string | null, activeWorkspaceId: string | null) {
  const [text, setText] = useState("");
  // 草稿页（sessionId=null）按工作空间存：新会话页上打的字切走再回来不丢
  // （旧模型每个"新建会话"都是真会话、草稿天然有家；草稿化后 hero 是唯一落点）。
  const draftKey = draftKeyOf(sessionId, activeWorkspaceId);
  useEffect(() => {
    if (draftKey) setText(localStorage.getItem(draftKey) ?? "");
  }, [draftKey]);
  useEffect(() => {
    if (!draftKey) return;
    const timer = setTimeout(() => writeDraft(draftKey, text), 250);
    return () => clearTimeout(timer);
  }, [text, draftKey]);
  return { text, setText, draftKey };
}
