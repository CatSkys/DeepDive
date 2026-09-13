import { useCallback, useEffect, useState } from "react";
import { Link2, RefreshCw, Smartphone, Square } from "lucide-react";
import css from "./RemoteControl.module.css";
import rowsCss from "../settings/SettingsRows.module.css";
import {
  remoteCopyLink, remoteRefresh, remoteRevoke, remoteStart, remoteStatus, remoteStop,
  type RemoteDevice, type RemoteStatus,
} from "../host";
import { formatClock } from "../session/format";
import { BotChannelCard } from "../bots/BotChannelCard";
import { useT } from "../i18n";

// 设置 → 移动端远程控制：手机扫码配对后接管当前工作区。局域网监听、配对
// 令牌、设备台账都在壳侧（RemoteAccess），这里只渲染快照并转发动作——前端
// 不自己拼远程状态，也不替壳判断谁能进来。

/** UA 归类 → 展示名（壳只给 kind，文案归 i18n）。 */
const KIND_LABEL: Record<string, string> = {
  iphone: "iPhone",
  ipad: "iPad",
  android: "Android",
  mac: "Mac",
};

/** 轮询间隔：手机连上后要在一两拍内把「等待手机连接」换成已连接。 */
const POLL_MS = 4000;

export function RemoteControlSection() {
  const { t, tt } = useT();
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const pull = useCallback(() => {
    void remoteStatus().then(setStatus);
  }, []);

  useEffect(() => { pull(); }, [pull]);

  const running = status?.on === true;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") pull();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, pull]);

  const run = useCallback((action: () => Promise<RemoteStatus>) => {
    setBusy(true);
    void action().then(setStatus).finally(() => setBusy(false));
  }, []);

  const copyLink = () => {
    if (!status?.url) return;
    remoteCopyLink(status.url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const devices = status?.devices ?? [];

  return (
    <div className={css.grid}>
      <div className={rowsCss.section}>
        <div className={rowsCss.sectionTitle}>{t("手机扫码连接")}</div>
      <div className={rowsCss.sectionIntro}>{t("用手机相机扫码，在手机上打开这个工作区。")}</div>

      {!running ? (
        <div className={css.card}>
          <div className={css.offBody}>
            <button
              type="button"
              className={rowsCss.primaryButton}
              disabled={busy}
              onClick={() => run(remoteStart)}
            >
              <Smartphone size={13} />
              {t("开启远程访问")}
            </button>
            <p className={css.warn}>
              {t("开启后，同一局域网内的手机浏览器可以控制这台 Mac 上的工作区（包括执行命令），请只在可信网络下使用。")}
            </p>
            <p className={css.note}>
              {t("手机需与这台 Mac 处在同一局域网。首次开启时 macOS 可能询问是否允许接受传入连接，选「允许」才能连上。")}
            </p>
          </div>
        </div>
      ) : (
        <div className={css.card}>
          <div className={css.statusRow}>
            <div className={css.statusMain}>
              <span className={css.statusDot} data-on={devices.length > 0 ? "true" : "false"} />
              <span className={css.statusText}>
                {devices.length > 0
                  ? tt("已连接 {n} 台设备", "{n} device(s) connected", { n: devices.length })
                  : t("等待手机连接")}
              </span>
              {devices.map((device) => (
                <span key={device.id} className={css.kindBadge}>{kindLabel(device, t)}</span>
              ))}
            </div>
            <button type="button" className={rowsCss.secondaryButton} disabled={busy} onClick={() => run(remoteStop)}>
              <Square size={11} />
              {t("停止")}
            </button>
          </div>

          <div className={css.hint}>{t("用手机扫码，或在手机上打开链接。")}</div>

          <div className={css.actionsRow}>
            <span className={css.actionsHint}>{t("无法扫码？可以在手机上打开链接。")}</span>
            <button type="button" className={rowsCss.secondaryButton} disabled={busy} onClick={() => run(remoteRefresh)}>
              <RefreshCw size={12} />
              {t("刷新二维码")}
            </button>
            <button type="button" className={rowsCss.secondaryButton} disabled={!status?.url} onClick={copyLink}>
              <Link2 size={12} />
              {copied ? t("已复制") : t("复制链接")}
            </button>
          </div>

          <div className={css.qrWrap}>
            {status?.qr ? (
              <img className={css.qr} src={status.qr} alt={t("远程访问二维码")} />
            ) : (
              <p className={css.qrMissing}>{t("这台 Mac 现在没有局域网地址，先连上 Wi-Fi 或网线。")}</p>
            )}
          </div>

          {devices.length > 0 && (
            <div className={css.devices}>
              <div className={css.devicesTitle}>{t("已配对设备")}</div>
              {devices.map((device) => (
                <div key={device.id} className={css.deviceRow}>
                  <div className={css.deviceIdentity}>
                    <div className={css.deviceName}>{kindLabel(device, t)}</div>
                    <div className={css.deviceCaption}>
                      {tt("配对时间 {time}", "Paired {time}", { time: formatClock(device.pairedAt * 1000) })}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={rowsCss.dangerButton}
                    onClick={() => run(() => remoteRevoke(device.id))}
                  >
                    {t("解绑")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </div>

      {/* 右栏：把工作区接到聊天 Bot 上（参考图右栏版式）。数据与技术契约见
          bots/BotChannelCard 与 docs/SPEC-MOBILE-REMOTE.md。 */}
      <BotChannelCard />
    </div>
  );
}

function kindLabel(device: RemoteDevice, t: (s: string) => string): string {
  return KIND_LABEL[device.kind] ?? t("浏览器");
}
