// 应用内快捷键的窗口级派发：读 keybinds 注册表 → 调用对应动作。
// 只管「按了什么键、该做什么」；键位清单与判据在 keybinds.ts，各动作的实现在各自模块。

import { useEffect, useRef } from "react";
import { toggleCommandPalette } from "./components/CommandPalette";
import { openFindInConversation } from "./components/FindInConversation";
import { DD_EVENTS, dispatchAppEvent } from "./events";
import { comboFor, comboOf, isOff, KEYBIND_DEFS, workspaceDigitOf } from "./keybinds";
import type { Store } from "./store";

/** 挂一次（App 根部）：window 捕获段听键盘，按注册表派发。
 *
 *  为什么整段读「当下这一个」store：store 对象按状态重建（toggleSidebar 等闭包捕获了
 *  当时的 sidebarOverride），而这个监听只随 keybinds 重挂——直接闭包 store 会拿到旧副本，
 *  ⌘B 连按只生效一次（收得起、展不开）。动作同理走 ref 镜像。 */
export function useAppKeybinds(store: Store, actions: { openSettings: () => void }): void {
  const storeRef = useRef(store);
  storeRef.current = store;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const store = storeRef.current;
      const target = e.target as HTMLElement | null;
      const typing =
        !!target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      // ⌥1-9 切换第 N 个项目空间（固定键位，不入改键表）：输入框聚焦时放行
      // ——⌥数字在文本框里是 macOS 特殊字符输入，劫持会打断打字。
      // 这一段**必须在 comboOf 之前**：⌥2 的 e.key 是「™」不是「2」，comboOf 认不出它，
      // 先算 combo 再 `if (!combo) return` 就把这条路整个吃掉了（PITFALLS §4.37）。
      const digit = typing ? undefined : workspaceDigitOf(e);
      if (digit !== undefined) {
        const ws = store.workspaces[digit - 1];
        if (ws) {
          e.preventDefault();
          store.switchWorkspace(ws.workspaceId);
        }
        return;
      }
      const combo = comboOf(e);
      if (!combo) return;
      for (const def of KEYBIND_DEFS) {
        if (isOff(def.id, store.keybinds)) continue;
        if (combo !== comboFor(def.id, store.keybinds)) continue;
        // 输入中放行的例外：听写（要在输入框里唤起）、⌘B 侧栏、⌘K 搜索、⌘F 查找——
        // 都不是文本编辑键（⌘B 只在富文本里是加粗，本应用输入面都是纯文本），
        // 且 ⌘K/⌘F 必须放行才能「开着再按一次」把焦点收回自己的输入框
        const typingAllowed =
          def.id === "dictation" || def.id === "toggle-sidebar" ||
          def.id === "command-palette" || def.id === "find";
        if (typing && !typingAllowed) return;
        e.preventDefault();
        if (def.id === "new-session") store.openSession(null);
        else if (def.id === "toggle-sidebar") store.toggleSidebar();
        else if (def.id === "dictation") dispatchAppEvent(DD_EVENTS.dictationToggle);
        else if (def.id === "cycle-effort") dispatchAppEvent(DD_EVENTS.cycleEffort);
        else if (def.id === "open-settings") actionsRef.current.openSettings();
        // 搜索面板是开关：开着再按一次收起（⌘K）
        else if (def.id === "command-palette") toggleCommandPalette();
        else if (def.id === "find") openFindInConversation();
        return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [store.keybinds]);
}
