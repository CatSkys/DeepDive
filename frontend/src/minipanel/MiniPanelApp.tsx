// 迷你面板 web 薄入口（SPEC-SEMANTICS §6.1）：只管药丸命中区/条目列/悬停标签/
// 命令卡的渲染与动作上报。几何唯一来源在页面——条目列 rect 经 `miniPanelStrip`
// 推给壳，原生玻璃底板跟随；展开态由壳推 `miniPanelState`；命令卡的数据锚点
// （快捷空间最近会话）由主 SPA 经壳推 `miniPanelQuick`，本页直接调引擎 RPC。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Command, PanelLeft, SquarePen } from "lucide-react";
import { installHostBridge, onHostEvent, sendToShell } from "../host";
import { api } from "../api";
import { t } from "../i18n";
import type { CommandDescriptor } from "../types";
import css from "./MiniPanelApp.module.css";

export function MiniPanelApp() {
  const [expanded, setExpanded] = useState(false);
  const [side, setSide] = useState<"right" | "left">("right");
  const [quickSessionId, setQuickSessionId] = useState<string | null>(null);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const [commands, setCommands] = useState<CommandDescriptor[] | null>(null);
  const [status, setStatus] = useState({ running: false, attention: false, unseen: false });
  const stripRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    installHostBridge({});
    return onHostEvent((cmd, payload) => {
      if (cmd === "miniPanelState") {
        const p = (payload ?? {}) as { expanded?: boolean; side?: string };
        setExpanded(Boolean(p.expanded));
        if (p.side === "left" || p.side === "right") setSide(p.side);
        if (!p.expanded) setFlyoutOpen(false);
      }
      if (cmd === "miniPanelStatus") {
        const p = (payload ?? {}) as { running?: boolean; attention?: boolean; unseen?: boolean };
        setStatus({ running: Boolean(p.running), attention: Boolean(p.attention), unseen: Boolean(p.unseen) });
      }
      if (cmd === "miniPanelQuick") {
        const sid = (payload as { sessionId?: string | null } | undefined)?.sessionId ?? null;
        setQuickSessionId(sid || null);
        setCommands(null);
        setFlyoutOpen(false);
      }
    });
  }, []);

  // 命令卡数据：快捷空间最近会话的引擎命令目录（spec：已启用命令列表）。
  // 没有快捷会话时不出目录——空态如实，不放假数据。
  useEffect(() => {
    if (!flyoutOpen || !quickSessionId || commands !== null) return;
    let alive = true;
    api.commandsList(quickSessionId)
      .then((list) => {
        if (alive) setCommands(list.filter((c) => c.name !== "export"));
      })
      .catch(() => {
        if (alive) setCommands([]);
      });
    return () => {
      alive = false;
    };
  }, [flyoutOpen, quickSessionId, commands]);

  // 条目列 rect → 壳（玻璃底板跟随；getBoundingClientRect 已是视口坐标）。
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
  }, [expanded, flyoutOpen]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") sendToShell({ type: "miniPanel.collapse" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const runCommand = (name: string) => {
    if (!quickSessionId) return;
    api
      .commandExecute({ agentId: quickSessionId, line: `/${name}` })
      .catch(() => void 0);
    sendToShell({ type: "miniPanel.action", kind: "openSession", sessionId: quickSessionId });
  };

  return (
    <div className={css.root} data-expanded={expanded ? "1" : "0"} data-side={side}>
      {expanded ? (
        <>
          {/* 条目列外的窗口区域都是收起点（窗口级点击关闭；屏上窗口外区域树④ 收） */}
          <div className={css.scrim} onClick={() => sendToShell({ type: "miniPanel.collapse" })} />
          {flyoutOpen && (
            <div className={css.flyout} onClick={(e) => e.stopPropagation()}>
              {commands !== null && commands.length === 0 ? (
                <div className={css.flyoutEmpty}>{t("暂无命令")}</div>
              ) : (
                (commands ?? []).map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    className={css.flyoutRow}
                    onClick={() => runCommand(c.name)}
                  >
                    <span className={css.flyoutName}>/{c.name}</span>
                    {c.description && <span className={css.flyoutDesc}>{c.description}</span>}
                  </button>
                ))
              )}
            </div>
          )}
          {/* 条目列本体透明，玻璃由壳的原生底板铺（UI-SPEC §1.5）；transform 会把
              这里变成合成上下文——命令卡挂 .root，不挂 strip 内。 */}
          <div className={css.strip} ref={stripRef}>
            {(status.running || status.attention || status.unseen) && (
              <span
                className={css.pillDot}
                data-kind={status.attention ? "attention" : status.running ? "running" : "unseen"}
              />
            )}
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
                className={`${css.item} ${flyoutOpen ? css.itemActive : ""}`}
                onClick={() => setFlyoutOpen((v) => !v)}
              >
                <Command size={16} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </>
      ) : (
        // 收起态：窗口就是命中区（玻璃小胶囊由壳铺在右缘，页面只画状态点）
        <div className={css.pillHit} onClick={() => sendToShell({ type: "miniPanel.expand" })}>
          {(status.running || status.attention || status.unseen) && (
            <span
              className={css.pillDot}
              data-kind={status.attention ? "attention" : status.running ? "running" : "unseen"}
            />
          )}
        </div>
      )}
    </div>
  );
}
