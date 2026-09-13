import { useCallback, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import css from "./Bots.module.css";
import rowsCss from "../settings/SettingsRows.module.css";
import { api, type ImSnapshot } from "../api";
import { BotManageDialog } from "./BotManageDialog";
import { ChannelLogo } from "./ChannelLogo";
import { IM_CHANNELS, channelLogoKey } from "./im";
import { useT } from "../i18n";

// Bot Channel（设置 → 移动端远程控制 右栏）：把工作区接到聊天 Bot 上，
// 人去外面之后还能从手机上的聊天窗口继续用。状态全部来自插件自己的渠道面，
// 前端不猜：插件没铺上（路由不通）时整块显式降级，不留半死的空行。

type ChannelState = ImSnapshot | "unavailable" | undefined;

export function BotChannelCard() {
  const { t, tt } = useT();
  const [states, setStates] = useState<Record<string, ChannelState>>({});
  const [openChannel, setOpenChannel] = useState<string | null>(null);

  const pull = useCallback(() => {
    void Promise.all(IM_CHANNELS.map(async (channel) => {
      try {
        return [channel.id, await api.im.status(channel.id)] as const;
      } catch {
        // 路由 404/网络失败都归"这个渠道现在不可用"；是不是插件整体缺席由
        // 全部渠道都不可用来判定（下面）。
        return [channel.id, "unavailable"] as const;
      }
    })).then((rows) => setStates(Object.fromEntries(rows)));
  }, []);

  useEffect(() => { pull(); }, [pull]);

  const allUnavailable = IM_CHANNELS.every((c) => states[c.id] === "unavailable");
  const loaded = IM_CHANNELS.every((c) => states[c.id] !== undefined);

  return (
    <div className={rowsCss.section}>
      <div className={rowsCss.sectionTitle}>{t("使用 Bot Channel")}</div>
      <div className={rowsCss.sectionIntro}>{t("连接聊天 Bot，适合更长时间的移动端访问。")}</div>

      <div className={css.card}>
        {loaded && allUnavailable ? (
          <p className={css.empty}>{t("Bot Channel 未启用：引擎里没有装这个渠道插件。")}</p>
        ) : (
          <div className={css.channels}>
            {IM_CHANNELS.map((channel) => {
              const state = states[channel.id];
              return (
                <button key={channel.id} className={css.channelRow} onClick={() => setOpenChannel(channel.id)}>
                  <span className={css.channelIcon}><ChannelLogo channel={channelLogoKey(channel.id)} size={17} /></span>
                  <span className={css.channelMain}>
                    <span className={css.channelName}>{t(channel.label)}</span>
                    <span className={css.channelCaption}>
                      {tt("从{label}打开这个工作区。", "Open this workspace from {label}.", { label: t(channel.label) })}
                    </span>
                    <span className={css.channelState}>{stateLine(state, t, tt)}</span>
                  </span>
                  <ChevronRight size={14} className={css.channelChevron} />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {openChannel && (
        <BotManageDialog channel={openChannel} onClose={() => { setOpenChannel(null); pull(); }} />
      )}
    </div>
  );
}

/** 一行的状态文案：不可用（未启用）/ 未配置 / n 个机器人 · m 已连接。 */
function stateLine(state: ChannelState, t: (s: string) => string,
                   tt: (zh: string, en: string, vars?: Record<string, string | number>) => string): string {
  if (state === undefined) return t("检查中…");
  if (state === "unavailable") return t("这个渠道现在不可用。");
  if (state.totals.configured === 0) return t("还没有机器人，点这里新建。");
  return tt("{n} 个机器人 · {m} 已连接", "{n} bot(s) · {m} connected",
    { n: state.totals.configured, m: state.totals.connected });
}
