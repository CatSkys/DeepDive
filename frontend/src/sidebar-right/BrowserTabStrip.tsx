// 浏览器顶部那一行——**它就是这一格的"窗口标题栏"**（参考 `TabBar.swift`）：
// 一排标签胶囊 + 一枚跟着跑道尾的「+」（hover 整行才出现）+ 行尾的后退/前进/刷新/书签/「…」/「对话」。
//
// 标签页与地址栏**合二为一**（参考 editingTab 的同一套生命周期）：胶囊平时显示**标题**，
// 选中那枚带阅读进度灰底；**单击选中的那枚**就地把胶囊展开成地址框（短地址、全选、
// min(340, room) 宽），Enter 提交（敲进去的当地址/搜索词）、Esc 收回（草稿作废）、
// 点外面=保留提交；地址没变就不重新加载。⌘L 走同一条路。
//
// 右端那一格一格两职：指向时是关闭叉，加载中是转圈，两者叠在同一格。关闭叉永远在——
// 关掉最后一个由壳补一个空白页，不是"没反应"。页面在响或被静音时，叉前面还有一枚可按的喇叭。
//
// 标签多了整排横向滚；换标签把当前那枚滚回可视区。编辑中切标签就地收回。
//
// 与参考的一处必要差异：它一个窗口就是一个浏览器，这一行直接吃窗口的标题栏（交通灯嵌在行首）；
// 我们的浏览器是聊天窗口里的一格，所以这一行占面板顶部，交通灯是应用自己的、不在这里。
import { useEffect, useRef, useState } from "react";
import { Plus, Volume2, VolumeX, X } from "lucide-react";
import { t, tt } from "../i18n";
import { AddressField } from "./BrowserAddressField";
import { shortAddress } from "./browserUrl";
import type { PaneFace } from "./useIframeBrowser";
import type { BrowserTabFace } from "./useNativeBrowser";

/** 主机名（降级首字母与提示用它）：去掉 www.，解析不出就回空。 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** 标签名（参考 `Tab.label` 的同一口径）：标题 → 主机名 → "新标签页"。 */
function tabName(tab: BrowserTabFace): string {
  if (tab.title !== "") return tab.title;
  return hostOf(tab.url) || t("新标签页");
}

/** 站点图标；页面没声明或取不到就退回主机名首字母；空白标签什么都不放（参考 isBlank 同一档）。 */
function TabIcon({ tab }: { tab: BrowserTabFace }) {
  const [broken, setBroken] = useState(false);
  if (tab.url === "") return null;
  if (broken || tab.icon === "") {
    return <span className="panel-browser-tab-glyph">{hostOf(tab.url).slice(0, 1).toUpperCase()}</span>;
  }
  return <img className="panel-browser-tab-icon" src={tab.icon} alt="" onError={() => setBroken(true)} />;
}

/** 页面在响/被静音时叉前面那枚喇叭（可按）。加载中不出——响没响要等页面落地才算数。 */
function Speaker({ tab, onMute }: { tab: BrowserTabFace; onMute: (id: string, muted: boolean) => void }) {
  if (tab.loading || !(tab.noisy || tab.muted)) return null;
  return (
    <button
      type="button"
      className="panel-browser-tab-speaker"
      aria-label={tab.muted ? t("取消静音") : t("静音")}
      data-tip={tab.muted ? t("取消静音") : t("静音")}
      onClick={(e) => { e.stopPropagation(); onMute(tab.id, !tab.muted); }}
    >
      {tab.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
    </button>
  );
}

/** 右端那一格，一格两职（两个都叠放在同一格里，不互相挤位）：
 *  加载中是转圈，指向时关闭叉盖在它上面。关掉最后一个标签是壳补一个空白页。 */
function EndSlot({ tab, onClose }: { tab: BrowserTabFace; onClose: () => void }) {
  return (
    <span className="panel-browser-tab-end">
      {tab.loading && <span className="panel-browser-tab-ring" aria-label={t("加载中")} />}
      <button
        type="button"
        className="panel-browser-tab-close"
        aria-label={t("关闭标签")}
        data-tip={t("关闭标签")}
        onClick={onClose}
      >
        <X size={11} />
      </button>
    </span>
  );
}

export function BrowserTabStrip({ face, tabs, activeId, onSelect, onClose, onNew, focusTick = 0, onMute, trailing }: {
  face: PaneFace;
  tabs: BrowserTabFace[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  /** 变化即把选中标签展开成地址框一次（壳转来的 ⌘L） */
  focusTick?: number;
  /** 静音/恢复某个标签的页面声音 */
  onMute: (id: string, muted: boolean) => void;
  /** 行尾那一组（后退/前进/刷新/书签/「…」/「对话」），由 BrowserToolbar 给 */
  trailing: React.ReactNode;
}) {
  const active = tabs.find((tab) => tab.id === activeId);
  /** 选中标签展开成地址框（参考 editingTab；单击它或 ⌘L 进来，Esc/提交/点外头出去） */
  const [editing, setEditing] = useState(false);
  /** 每次展开都要重新聚焦+全选一次 */
  const [editTick, setEditTick] = useState(0);
  /** Esc 收回后紧跟着的失焦别再走提交 */
  const justCancelled = useRef(false);
  const runRef = useRef<HTMLDivElement>(null);
  /** 选中胶囊的灰底：一枚**会滑**的底（参考 matchedGeometryEffect——切换标签时灰底
   *  从旧标签滑到新标签，不是一灭一亮）。位置从真实 DOM 量出来。 */
  const [glide, setGlide] = useState<{ left: number; width: number } | null>(null);
  const glidePlaced = useRef(false);
  /** 紧凑档：胶囊压到 80 以下就只显示图标（参考 tabTitled 的同一门槛） */
  const [compact, setCompact] = useState(false);

  const beginEdit = () => {
    if (!active) return;
    // 短地址（bilibili.com 式）进框，参考 beginTabEdit 的 Address.pretty 同一口径
    face.setDraft(shortAddress(active.url));
    setEditing(true);
    setEditTick((tick) => tick + 1);
  };
  /** 收回。`commit` = 点外面/Enter 的"保留提交"：地址变了就当提交走（参考 finishTabEdit）；
   *  Esc 是作废（cancelTabEdit），草稿退回镜像。 */
  const collapse = (commit: boolean) => {
    setEditing(false);
    if (commit && active) {
      const draft = face.draft.trim();
      if (draft !== "" && draft !== shortAddress(active.url)) {
        face.setDraft(draft);
        face.submit();
        return;
      }
    }
    face.cancel();
  };
  /** 地址框里选定了要去的地址（补全项或敲完的 Return）：地址没变就只收回，不重新加载 */
  const pickFromField = (url: string) => {
    if (active && url !== active.url) {
      face.setDraft(url);
      face.submit();
    } else {
      face.cancel();
    }
    setEditing(false);
  };

  // 首帧定位完成后再开过渡：否则灰底会从 0 处滑过来
  useEffect(() => {
    if (glide) {
      const tick = requestAnimationFrame(() => { glidePlaced.current = true; });
      return () => cancelAnimationFrame(tick);
    }
  }, [glide]);

  // 壳转来的 ⌘L：展开成地址框
  useEffect(() => {
    if (focusTick !== 0) beginEdit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);
  // 切标签就地收回（草稿已由壳事件那头重置）
  useEffect(() => {
    setEditing(false);
  }, [activeId]);
  // 灰底滑到选中那枚 + 紧凑档判定 + 把当前那枚滚回可视区（同一次测量全干了）
  useEffect(() => {
    const run = runRef.current;
    const box = run?.querySelector(".panel-browser-tab.live") as HTMLElement | null;
    if (!run || !box) { setGlide(null); return; }
    setGlide({ left: box.offsetLeft, width: box.offsetWidth });
    setCompact(!editing && box.offsetWidth < 80);
    if (box.offsetLeft < run.scrollLeft) run.scrollTo({ left: box.offsetLeft });
    else if (box.offsetLeft + box.offsetWidth > run.scrollLeft + run.clientWidth) {
      run.scrollTo({ left: box.offsetLeft + box.offsetWidth - run.clientWidth });
    }
  }, [activeId, tabs, editing]);

  return (
    <div className="panel-browser-chrome" role="tablist" aria-label={t("标签页")}>
      {/* 滚动区只装标签（「+」在区外贴着尾巴，滚多远它都在）。
          **按 tabs 原位顺序渲染**（参考 ForEach(browser.tabs) 的同一条铁律）：选中的那枚
          只是被高亮、就地展开，不挪窝——挪窝就是用户看到的"标签跑来跑去"。
          灰底是一枚会滑的公共底（matchedGeometryEffect 同一观感），胶囊本体不带底色；
          未选中标签与跑道同色融为一体（参考的极简：没有分割线、没有选框）。 */}
      <div className={`panel-browser-chrome-run${compact ? " compact" : ""}`} ref={runRef}>
        {glide && (
          <span
            className="panel-browser-chrome-glide"
            style={{ left: glide.left, width: glide.width, transition: glidePlaced.current ? undefined : "none" }}
          >
            {active && (
              <span
                className="panel-browser-tab-read"
                style={{ width: `${Math.round(Math.min(1, Math.max(0, active.reading ?? 0)) * 100)}%` }}
              />
            )}
          </span>
        )}
        {tabs.map((tab) => {
          if (tab.id === activeId && editing) {
            return (
              <div key={tab.id} className={`panel-browser-tab live editing${tab.asleep ? " asleep" : ""}`}>
                <div className="panel-browser-tab-live-field">
                  <AddressField
                    face={face}
                    focusTick={editTick}
                    onEditingChange={(on) => {
                      if (on) return;
                      if (justCancelled.current) { justCancelled.current = false; return; }
                      collapse(true);
                    }}
                    onCancel={() => { justCancelled.current = true; collapse(false); }}
                    onPick={pickFromField}
                  />
                </div>
              </div>
            );
          }
          const name = tabName(tab);
          return (
            <div key={tab.id} className={`panel-browser-tab${tab.id === activeId ? " live" : ""}${tab.asleep ? " asleep" : ""}`}>
              <button
                type="button"
                role="tab"
                aria-selected={tab.id === activeId}
                className="panel-browser-tab-body"
                aria-label={tab.asleep ? tt("{name}（已休眠）", "{name} (asleep)", { name }) : name}
                data-tip={name}
                onClick={tab.id === activeId ? beginEdit : () => onSelect(tab.id)}
              >
                <TabIcon tab={tab} />
                <span className="panel-browser-tab-title">{name}</span>
              </button>
              <Speaker tab={tab} onMute={onMute} />
              <EndSlot tab={tab} onClose={() => onClose(tab.id)} />
            </div>
          );
        })}
      </div>
      {/* 「+」紧跟最后一枚（参考同一取舍：跑道滚多远它都在），hover 整行才出现 */}
      <button
        type="button"
        className="panel-browser-tab-new"
        aria-label={t("新建标签")}
        data-tip={t("新建标签")}
        onClick={onNew}
      >
        <Plus size={13} />
      </button>
      <div className="panel-browser-chrome-end">{trailing}</div>
    </div>
  );
}
