// 草稿持久化 hook：composer 文本按会话（草稿页按工作空间）读写
// localStorage，空稿清除、变更 250ms 防抖落盘。只管草稿键的存取；
// 发送成功后的清除由编排方拿返回的 draftKey 自己做。

import { useEffect, useState } from "react";

export function useComposerDraft(sessionId: string | null, activeWorkspaceId: string | null) {
  const [text, setText] = useState("");
  // 草稿页（sessionId=null）按工作空间存：新会话页上打的字切走再回来不丢
  // （旧模型每个"新建会话"都是真会话、草稿天然有家；草稿化后 hero 是唯一落点）。
  const draftKey = sessionId
    ? `deepdive.draft.${sessionId}`
    : activeWorkspaceId
      ? `deepdive.draft.hero.${activeWorkspaceId}`
      : null;
  useEffect(() => {
    if (draftKey) setText(localStorage.getItem(draftKey) ?? "");
  }, [draftKey]);
  useEffect(() => {
    if (!draftKey) return;
    const timer = setTimeout(() => {
      if (text) localStorage.setItem(draftKey, text);
      else localStorage.removeItem(draftKey);
    }, 250);
    return () => clearTimeout(timer);
  }, [text, draftKey]);
  return { text, setText, draftKey };
}
