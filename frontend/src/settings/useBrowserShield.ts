// 浏览器设置页「隐私」分节的壳侧数据：拦截开关、按站暂停的站点、记住的摄像头/麦克风权限。
//
// 与壳的报文：发 `browser-shield`（action: sync | forgetPaused | forgetPermissions，或 enabled）
// 与 `browser-permission`（action: forgetAll），收 `browserShield`（enabled / paused / permissions）。
import { useCallback, useEffect, useState } from "react";
import { onHostEvent, sendToShell } from "../host";

export interface BrowserShieldFace {
  enabled: boolean;
  /** 被暂停拦截的站点（host） */
  paused: string[];
  /** 记住过的摄像头/麦克风决定条数 */
  permissions: number;
  /** 规则表编译失败的原因（空 = 正常）：开关写着"开"而这里非空，就是实际什么都没挡 */
  trouble: string;
}

const EMPTY: BrowserShieldFace = { enabled: true, paused: [], permissions: 0, trouble: "" };

export function useBrowserShield() {
  const [state, setState] = useState<BrowserShieldFace>(EMPTY);

  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd !== "browserShield") return;
    const data = payload as Partial<BrowserShieldFace> | undefined;
    setState({
      enabled: typeof data?.enabled === "boolean" ? data.enabled : true,
      paused: Array.isArray(data?.paused) ? data.paused.filter((h): h is string => typeof h === "string") : [],
      permissions: Number(data?.permissions ?? 0),
      trouble: typeof data?.trouble === "string" ? data.trouble : "",
    });
  }), []);

  const sync = useCallback(() => sendToShell({ type: "browser-shield", action: "sync" }), []);
  const setEnabled = useCallback((on: boolean) => sendToShell({ type: "browser-shield", enabled: on }), []);
  const forgetPaused = useCallback(() => sendToShell({ type: "browser-shield", action: "forgetPaused" }), []);
  const forgetPermissions = useCallback(() => sendToShell({ type: "browser-permission", action: "forgetAll" }), []);

  return { state, sync, setEnabled, forgetPaused, forgetPermissions };
}
