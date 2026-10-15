// 标题栏那颗「有更新」钮 + 它的 hover 说明卡：下载中显示进度状态，下载好显示版本、
// 发布日期、发布说明正文与「重启以安装」。
//
// 钮在**下载期就出现**（不是等下载完才冒出来）：Sparkle 是静默下载，只有下完那一瞬才
// 出现的入口会让人以为更新是凭空冒出来的，也看不到「正在下载」这件事。没有更新在途时
// 这颗钮根本不存在——不留一个点下去没反应的入口。
//
// 说明正文来自 appcast 的 `sparkle:releaseNotesLink`（发布链每次上传的那份 Markdown，
// 由 docs/release-notes/ 里撰写的说明产出），壳拉回来经桥推给这里；渲染走既有 Markdown
// 管线（React 逐节点转义成 JSX，不走 dangerouslySetInnerHTML）。
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
  // 说明正文默认展开（原来就是这个信息量，折叠只是多给一个压缩手段）。
  const [notesOpen, setNotesOpen] = useState(true);
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

  if (!state) return null;
  // 待装的压过在下的一份：下载完那一刻两个字段会同时短暂为真，那时该显示「已下载」。
  const isReady = state.readyVersion !== null;
  const version = state.readyVersion ?? state.downloadingVersion;
  if (!version) return null;

  const title = isReady
    ? tt("已下载 {version}", "Downloaded {version}", { version })
    : tt("正在下载 {version}", "Downloading {version}", { version });
  const date = isReady && state.readyDate ? formatReleaseDate(state.readyDate, lang) : "";
  const notes = isReady ? state.readyNotes : null;

  return (
    <>
      <button
        ref={buttonRef}
        className="window-top-btn update-badge"
        aria-label={title}
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
          <span className="update-card-title">{title}</span>
          {date && <span className="update-card-date">{date}</span>}
        </div>
        {/* 下载期到此为止：说明还没拉回来，也还没有可点的安装动作。 */}
        {isReady && (
          <>
            <div className="update-card-div" />
            {notes && notesOpen && (
              <div className="update-card-notes">
                <Markdown text={notes} />
              </div>
            )}
            {notes && (
              <button
                type="button"
                className="update-card-toggle"
                aria-expanded={notesOpen}
                onClick={() => setNotesOpen((v) => !v)}
              >
                {notesOpen ? t("收起") : t("查看本版变更")}
              </button>
            )}
            <div className="update-card-div" />
            {/* 与设置→关于那一行同一句话、同一词条：同一件事只有一份措辞。 */}
            <div className="update-card-caption">
              {t("退出 DeepDive 时自动安装；也可以现在就装，应用会重启一次。")}
            </div>
            <button type="button" className="update-card-install" onClick={() => installUpdate()}>
              {t("重启以安装")}
            </button>
          </>
        )}
      </Popover>
    </>
  );
}
