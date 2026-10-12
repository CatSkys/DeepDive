// 迷你面板 web 薄入口（SPEC-SEMANTICS §6.1）：只管药丸命中区/条目列/悬停标签的
// 渲染与动作上报。几何唯一来源在页面——条目列 rect 经 `miniPanelStrip` 推给壳，
// 原生玻璃底板跟随；展开态由壳推 `miniPanelState`。命令卡与快捷会话落点在树③。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Command, PanelLeft, SquarePen } from "lucide-react";
import { installHostBridge, onHostEvent, sendToShell } from "../host";
import { t } from "../i18n";
import css from "./MiniPanelApp.module.css";

export function MiniPanelApp() {
  const [expanded, setExpanded] = useState(false);
  const stripRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    installHostBridge({});
    return onHostEvent((cmd, payload) => {
      if (cmd === "miniPanelState") {
        setExpanded(Boolean((payload as { expanded?: boolean } | undefined)?.expanded));
      }
    });
  }, []);

  // 条目列 rect → 壳（玻璃底板跟随；rect 含 transform 前的布局值即可，
  // getBoundingClientRect 已是视口坐标）。收起态没有条目列，不推。
  useLayoutEffect(() => {
    if (!expanded) return;
    const el = stripRef.current;
    if (!el) return;
    const push = () => {
      const r = el.getBoundingClientRect();
      sendToShell({
        type: "miniPanelStrip",
        rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      });
    };
    push();
    const ro = new ResizeObserver(push);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") sendToShell({ type: "miniPanel.collapse" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  return (
    <div className={css.root} data-expanded={expanded ? "1" : "0"}>
      {expanded ? (
        <>
          {/* 条目列外的窗口区域都是收起点（窗口级点击关闭；屏上窗口外区域树④ 收） */}
          <div className={css.scrim} onClick={() => sendToShell({ type: "miniPanel.collapse" })} />
          {/* 条目列本体透明，玻璃由壳的原生底板铺（UI-SPEC §1.5）；transform 会把
              这里变成合成上下文——树③ 的命令卡必须 portal 到 .root，不挂 strip 内。 */}
          <div className={css.strip} ref={stripRef}>
            <div className={css.itemWrap}>
              <span className={css.label}>{t("打开本体")}</span>
              <button
                type="button"
                className={css.item}
                onClick={() => sendToShell({ type: "miniPanel.action", kind: "openMain" })}
              >
                <PanelLeft size={16} strokeWidth={1.5} />
              </button>
            </div>
            <div className={css.itemWrap}>
              <span className={css.label}>{t("新会话")}</span>
              <button
                type="button"
                className={css.item}
                onClick={() => sendToShell({ type: "miniPanel.action", kind: "newSession" })}
              >
                <SquarePen size={16} strokeWidth={1.5} />
              </button>
            </div>
            <div className={css.itemWrap}>
              <span className={css.label}>{t("命令")}</span>
              <button
                type="button"
                className={css.item}
                onClick={() => sendToShell({ type: "miniPanel.action", kind: "commands" })}
              >
                <Command size={16} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </>
      ) : (
        // 收起态：窗口就是命中区（玻璃小胶囊由壳铺在右缘，页面不画任何东西）
        <div className={css.pillHit} onClick={() => sendToShell({ type: "miniPanel.expand" })} />
      )}
    </div>
  );
}
