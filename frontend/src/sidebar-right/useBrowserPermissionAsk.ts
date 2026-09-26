// 网页要摄像头/麦克风时，壳把问题推过来（`browserPermissionAsk`）：用应用自己的弹窗问一次，
// 答案回壳（壳按"站点 + 种类"记住，下次不再问；30s 没人答那边就拒绝）。
//
// 挂在应用根上而不是设置页里——面板关着的时候也可能有页面在问。
import { useEffect } from "react";
import { onHostEvent, sendToShell } from "../host";
import { t, tt } from "../i18n";
import { confirmDialog } from "../components/DialogHost";

/** 壳给的种类短名 → 给人看的词。 */
function whatFor(kind: string): string {
  if (kind === "camera") return t("摄像头");
  if (kind === "microphone") return t("麦克风");
  return t("摄像头与麦克风");
}

export function useBrowserPermissionAsk(): void {
  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd !== "browserPermissionAsk") return;
    const data = payload as { host?: unknown; kind?: unknown } | undefined;
    const host = typeof data?.host === "string" ? data.host : "";
    const kind = typeof data?.kind === "string" ? data.kind : "";
    if (host === "" || kind === "") return;
    void confirmDialog({
      message: tt("“{host}”想使用{what}。允许一次之后，这个站点不再问。", "\"{host}\" wants to use your {what}. Once allowed, this site will not ask again.", {
        host,
        what: whatFor(kind),
      }),
    }).then((allow) => sendToShell({ type: "browser-permission", host, kind, allow }));
  }), []);
}
