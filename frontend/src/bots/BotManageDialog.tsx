import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, QrCode, Trash2, X } from "lucide-react";
import css from "./Bots.module.css";
import rowsCss from "../settings/SettingsRows.module.css";
import { api, type ImBot, type ImProvision, type ImSnapshot } from "../api";
import { qrEncode } from "../host";
import { channelLabel, provisionPending } from "./im";
import { useT } from "../i18n";
import { confirmDialog } from "../components/DialogHost";

// 机器人管理弹窗：一个渠道的机器人台账 + 扫码新建。数据全来自插件自己的渠道
// 面（api.im），这里只做呈现与动作转发——配对令牌、凭据存储、连接状态都在
// 插件的宿主侧，前端不复制一份。
//
// 配对是一条有状态的流程：begin 拿 verificationUrl（二维码内容）→ 按插件给的
// 间隔轮询 poll → connected / expired / failed。关窗即 cancel，不留后台尝试。

export function BotManageDialog({ channel, onClose }: { channel: string; onClose: () => void }) {
  const { t, tt } = useT();
  const [snapshot, setSnapshot] = useState<ImSnapshot | null>(null);
  const [provision, setProvision] = useState<ImProvision | null>(null);
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const attemptRef = useRef<string | null>(null);
  /** 用户显式取消过：不再自动重开配对（否则取消立刻又被拉起来）。 */
  const cancelledRef = useRef(false);
  const label = channelLabel(channel);

  const startPairing = useCallback(() => {
    setBusy(true);
    setError("");
    void api.im.begin(channel, "zh-CN").then((attempt) => {
      attemptRef.current = attempt.attemptId;
      setProvision(attempt);
      if (attempt.verificationUrl) void qrEncode(attempt.verificationUrl).then(setQr);
    }).catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
  }, [channel]);

  const pull = useCallback(() => {
    void api.im.status(channel).then((next) => {
      setSnapshot(next);
      // 这个渠道一个机器人都没有时，打开就该直接看到二维码——不必再点一次
      // 「新建机器人」（用户反馈：点开这个渠道本来就是想加机器人）。
      if (!cancelledRef.current && next.bots.length === 0) {
        setProvision((current) => {
          if (current === null && !attemptRef.current) startPairing();
          return current;
        });
      }
    }).catch((e: Error) => setError(e.message));
  }, [channel, startPairing]);

  useEffect(() => { pull(); }, [pull]);

  // 配对轮询：插件给 pollIntervalMs（实测 1s）；结束态即停。
  useEffect(() => {
    if (!provision || !provisionPending(provision.status)) return;
    const timer = window.setTimeout(() => {
      void api.im.poll(channel, provision.attemptId).then((next) => {
        setProvision(next);
        if (next.status === "connected") {
          attemptRef.current = null;
          setProvision(null);
          setQr("");
          pull();
        }
      }).catch((e: Error) => { setError(e.message); attemptRef.current = null; setProvision(null); });
    }, Math.max(400, provision.pollIntervalMs || 1000));
    return () => window.clearTimeout(timer);
  }, [provision, channel, pull]);

  const close = useCallback(() => {
    const attempt = attemptRef.current;
    if (attempt) void api.im.cancel(channel, attempt).catch(() => void 0 /* 尝试可能已自行结束 */);
    onClose();
  }, [channel, onClose]);

  const stopPairing = () => {
    cancelledRef.current = true;
    const attempt = attemptRef.current;
    attemptRef.current = null;
    setProvision(null);
    setQr("");
    if (attempt) void api.im.cancel(channel, attempt).catch(() => void 0 /* 尝试可能已自行结束 */);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const removeBot = async (bot: ImBot) => {
    const ok = await confirmDialog({
      message: tt("移除机器人「{name}」？移除后它不再响应{label}消息。",
        "Remove bot “{name}”? It will stop answering {label} messages.", { name: bot.bot.name, label }),
      title: t("机器人"),
      confirmLabel: t("移除"),
      danger: true,
    });
    if (!ok) return;
    void api.im.removeBot(channel, bot.botId).then(setSnapshot).catch((e: Error) => setError(e.message));
  };

  const bots = snapshot?.bots ?? [];

  return createPortal(
    <div className={rowsCss.modalOverlay} onClick={close} role="dialog" aria-label={t("机器人")}>
      <div className={rowsCss.modal} onClick={(e) => e.stopPropagation()}>
        <div className={rowsCss.modalHead}>
          <span className={rowsCss.modalTitle}>{tt("{label}机器人", "{label} bots", { label })}</span>
          {/* 关闭钮顶到右上角（modalHead 是 flex 行，marginLeft:auto 推到行尾）——
              与 ModelDialog 同款做法，别写成紧跟标题。 */}
          <button className={rowsCss.iconBtn} style={{ marginLeft: "auto" }} onClick={close} aria-label={t("关闭")}>
            <X size={15} />
          </button>
        </div>

        <div className={rowsCss.modalBody}>
          {error && <p className={css.error}>{error}</p>}

          {provision ? (
            <div className={css.pairPane}>
              {qr
                ? <img className={css.pairQr} src={qr} alt={t("配对二维码")} />
                : <div className={css.pairQrPending}><QrCode size={26} /></div>}
              <p className={css.pairHint}>
                {provision.status === "scanned" || provision.status === "needs_verification"
                  ? t("已扫码，请在手机上确认。")
                  : tt("用{label}扫这个二维码完成关联。", "Scan this code in {label} to link.", { label })}
              </p>
            </div>
          ) : (
            <>
              <div className={css.manageHead}>
                <span className={css.manageHint}>{t("扫码后自动保存凭据。")}</span>
                <button className={rowsCss.secondaryButton} disabled={busy} onClick={startPairing}>
                  <Plus size={12} />
                  {t("新建机器人")}
                </button>
              </div>

              {bots.length === 0 ? (
                <p className={css.empty}>{t("这个渠道还没有机器人。")}</p>
              ) : (
                bots.map((bot) => (
                  <div key={bot.botId} className={css.botRow}>
                    <div className={css.botIdentity}>
                      <div className={css.botName}>
                        <span className={css.botDot} data-tone={bot.connected ? "on" : "off"} />
                        {bot.bot.name}
                      </div>
                      <div className={css.botCaption}>{bot.health.summary || bot.bot.accountIdMasked}</div>
                      {bot.workspace && <div className={css.botCaption}>{bot.workspace}</div>}
                    </div>
                    <button className={rowsCss.dangerButton} onClick={() => void removeBot(bot)}>
                      <Trash2 size={12} />
                      {t("移除")}
                    </button>
                  </div>
                ))
              )}
            </>
          )}
        </div>

        {/* 动作行：与全站弹窗一致放页脚右对齐（modalFoot），不塞进正文里居中 */}
        {provision && (
          <div className={rowsCss.modalFoot}>
            <button className={rowsCss.secondaryButton} onClick={stopPairing}>
              {t("取消")}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
