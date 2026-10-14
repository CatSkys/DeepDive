// 标题栏那颗「有更新待装」钮 + 它的 hover 说明卡：版本、发布日期、发布说明正文。
//
// 只在壳报「已下载待装的一份」时出现——没有待装更新时标题栏里就没有这颗钮，不留一个
// 点下去没反应的入口。说明正文来自 appcast 的 `sparkle:releaseNotesLink`（发布链每次
// 上传的那份 Markdown），壳拉回来经桥推给这里；渲染走既有 Markdown 管线（React 逐节点
// 转义成 JSX，不走 dangerouslySetInnerHTML）。
//
// 管什么：这一颗钮与这一张卡。不管什么：更新状态与动作——状态来自壳的 `updateState`
// （AppUpdater.swift），「检查更新」在设置→关于与菜单里。
//
// 两条别踩（都是仓库既有约束）：
// ① **不要在这颗钮上挂 `data-tip`**：原生 tooltip 与这张卡会同时冒出来（仓里 hover 型
//    浮层一律只留 aria-label，见 UsageMeter 的 ContextRing）。
// ② 它必须是真正的 `<button>`：标题栏拖拽区按 `button` 选择器判定可点元素
//    （titlebar.ts INTERACTIVE），换 span 就会被当成拖拽区。

import { useEffect, useRef, useState } from "react";
import { CircleArrowDown } from "lucide-react";
import { Markdown } from "./Markdown";
import { Popover } from "./Popover";
import { installUpdate, narrowUpdateState, onHostEvent, type UpdateState } from "../host";
import { useT, type Lang } from "../i18n";

/** appcast 的 pubDate（ISO8601）按当前语言排版；认不出来给空串——卡片就不显示日期
 *  那一行（不显示比显示 "Invalid Date" 诚实）。 */
export function formatReleaseDate(iso: string, lang: Lang): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "en" ? "en-US" : "zh-CN", { dateStyle: "long" }).format(at);
}

export function UpdateBadge() {
  const { t, tt, lang } = useT();
  const [state, setState] = useState<UpdateState | null>(null);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // 钮与卡之间有 8px 缝，指针要安全走过去：延时关闭，指针进了卡就取消（同 ContextRing）。
  const closeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useEffect(() => onHostEvent((cmd, payload) => {
    if (cmd !== "updateState") return;
    const next = narrowUpdateState(payload);
    if (next) setState(next);
  }), []);

  const hover = (inside: boolean) => {
    window.clearTimeout(closeTimer.current);
    if (inside) setOpen(true);
    else closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  if (!state || !state.readyVersion) return null;
  const ready = state.readyVersion;
  const date = state.readyDate ? formatReleaseDate(state.readyDate, lang) : "";

  return (
    <>
      <button
        ref={buttonRef}
        className="window-top-btn update-badge"
        aria-label={tt("已下载 {version}", "Downloaded {version}", { version: ready })}
        onMouseEnter={() => hover(true)}
        onMouseLeave={() => hover(false)}
        onFocus={() => hover(true)}
        onBlur={() => hover(false)}
      >
        <CircleArrowDown size={17} />
      </button>
      <Popover
        open={open}
        anchor={buttonRef}
        onClose={() => setOpen(false)}
        side="bottom"
        sideOffset={8}
        align="start"
        className="update-card"
        // hover 驱动的浮层：外点不关（指针离开由上面的延时负责），Esc 照常关。
        dismissOnOutside={false}
        onMouseEnter={() => hover(true)}
        onMouseLeave={() => hover(false)}
      >
        <div className="update-card-head">
          <span className="update-card-title">
            {tt("已下载 {version}", "Downloaded {version}", { version: ready })}
          </span>
          {date && <span className="update-card-date">{date}</span>}
        </div>
        {state.readyNotes && (
          <>
            <div className="update-card-div" />
            <div className="update-card-notes">
              <Markdown text={state.readyNotes} />
            </div>
          </>
        )}
        <div className="update-card-div" />
        <button type="button" className="update-card-install" onClick={() => installUpdate()}>
          {t("重启以安装")}
        </button>
      </Popover>
    </>
  );
}
