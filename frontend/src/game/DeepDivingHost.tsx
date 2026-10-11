// DeepDiving 浮层的挂载壳（App 根部）：消费 openDeepDiving 请求（流末 loader 与
// 命令面板都走它）、浮层出现时复位 hover。面板本体在 DeepDiving.tsx。
import { useEffect, useState } from "react";
import { DD_EVENTS, dispatchAppEvent } from "../events";
import { registerDeepDiving } from "./store";
import { DeepDiving } from "./DeepDiving";

/** App 根部挂一次：消费 openDeepDiving 请求。 */
export function DeepDivingHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    registerDeepDiving(() => setOpen(true));
    return () => registerDeepDiving(null);
  }, []);
  // 浮层在静止指针下打开：hover 复位走命令面板同一条事件（同一通道，语义都是
  // 「浮层出现，指针停着的那处不算选」）
  useEffect(() => {
    if (open) dispatchAppEvent(DD_EVENTS.commandPalette);
  }, [open]);
  return open ? <DeepDiving onClose={() => setOpen(false)} /> : null;
}
