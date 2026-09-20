// 引擎命令目录（0.1.2 commands/list 的消费面，官方 ui-commands 的最小移植）：
// 按会话拉取目录，commands/change 广播（$events）时重拉；目录随引擎/插件面
// 走。过滤 /export：引擎在列但官方面按下载流呈现，SPA 无承接（旧 DSH-WIRE
// §4 拍板维持），入菜单即误导。
// 草稿页（无会话）没有引擎目录可拉——commands/list 的 agentId 必填，引擎命令
// 面只有 execute/list 两条路由，没有无会话的目录——退用前端内建表合成的兜底
// 车道（DRAFT_COMMANDS），草稿页因此也能发现内建命令；真实命令目录仍只由引擎
// 供给，插件命令只在会话车道可见。

import { useEffect, useState } from "react";
import { api } from "../../api";
import { DRAFT_COMMANDS } from "./builtinCommands";
import type { CommandDescriptor } from "../../types";

export function useSlashCommands(sessionId: string | null): CommandDescriptor[] {
  const [commands, setCommands] = useState<CommandDescriptor[]>([]);
  useEffect(() => {
    if (!sessionId) {
      setCommands([]);
      return;
    }
    let alive = true;
    const load = () => api.commandsList(sessionId)
      .then((list) => {
        if (alive) setCommands(list.filter((c) => c.name !== "export"));
      })
      .catch(() => {
        // engine 未就绪/繁忙：目录置空（菜单不出现），不弹错
        if (alive) setCommands([]);
      });
    void load();
    const off = api.onEvents({ onEmit: (event) => { if (event === "commands/change") void load(); } });
    return () => {
      alive = false;
      off();
    };
  }, [sessionId]);
  return sessionId === null ? DRAFT_COMMANDS : commands;
}
