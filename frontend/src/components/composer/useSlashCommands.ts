// 引擎命令目录（0.1.2 commands/list 的消费面，官方 ui-commands 的最小移植）：
// 按会话拉取目录，commands/change 广播（$events）时重拉；目录随引擎/插件面
// 走，前端不再持有静态清单。过滤 /export：引擎在列但官方面按下载流呈现，
// SPA 无承接（旧 DSH-WIRE §4 拍板维持），入菜单即误导。

import { useEffect, useState } from "react";
import { api } from "../../api";
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
  return commands;
}
