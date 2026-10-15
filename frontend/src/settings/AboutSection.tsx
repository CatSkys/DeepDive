// 设置 → 关于：当前应用版本号 + 应用更新（Sparkle）。只管这一屏的渲染与桥交互——
// 版本号与「有没有待装的一份」都来自壳（Sources/DeepDiveApp/AppUpdater.swift），
// 检查/安装的动作也都在壳里（桥命令 check-update / install-update）。

import { useEffect, useState } from "react";
import rowsCss from "./SettingsRows.module.css";
import {
  checkForUpdates, installUpdate, narrowUpdateState, onHostEvent, requestUpdateState,
  type UpdateState,
} from "../host";
import { useT } from "../i18n";

export function AboutSection() {
  const { t, tt } = useT();
  // null = 还没拿到壳的快照（页面刚挂载那一瞬）：版本号位置显示「读取中…」，
  // 更新入口先不摆——摆一个查不到状态的按钮比晚半拍更糟。
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    requestUpdateState();
    return onHostEvent((cmd, payload) => {
      if (cmd !== "updateState") return;
      const next = narrowUpdateState(payload);
      if (next) setState(next);
    });
  }, []);

  return (
    <div className={rowsCss.section}>
      <div className={rowsCss.sectionTitle}>{t("关于")}</div>
      <div className={rowsCss.rowGroup}>
        <div className={rowsCss.rowCard}>
          <div className={rowsCss.rowIdentity}>
            <div className={rowsCss.rowName}>{t("版本")}</div>
            <div className={rowsCss.rowCaption}>
              {state ? state.currentVersion : t("读取中…")}
            </div>
          </div>
          {state?.canUpdate && (
            <div className={rowsCss.rowActions}>
              <button
                type="button"
                className={rowsCss.secondaryButton}
                onClick={() => checkForUpdates()}
              >
                {t("检查更新")}
              </button>
            </div>
          )}
        </div>

        {/* 已经找到新版本、正在静默下载：也给一行状态——否则从点下「检查更新」到
            「已下载」之间整段是空白的，看起来像什么都没发生。 */}
        {state?.canUpdate && !state.readyVersion && state.downloadingVersion && (
          <div className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>
                {tt("正在下载 {version}", "Downloading {version}", { version: state.downloadingVersion })}
              </div>
              <div className={rowsCss.rowCaption}>
                {t("下载完成后，退出 DeepDive 时自动安装。")}
              </div>
            </div>
          </div>
        )}

        {/* 静默下载好的那一份：退出时会自己装上，这一行是「现在就想装」的入口。
            没有待装的一份时整行不出现。 */}
        {state?.canUpdate && state.readyVersion && (
          <div className={rowsCss.rowCard}>
            <div className={rowsCss.rowIdentity}>
              <div className={rowsCss.rowName}>
                {tt("已下载 {version}", "Downloaded {version}", { version: state.readyVersion })}
              </div>
              <div className={rowsCss.rowCaption}>
                {t("退出 DeepDive 时自动安装；也可以现在就装，应用会重启一次。")}
              </div>
            </div>
            <div className={rowsCss.rowActions}>
              <button
                type="button"
                className={rowsCss.primaryButton}
                onClick={() => installUpdate()}
              >
                {t("重启以安装")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
