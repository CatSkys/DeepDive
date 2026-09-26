// 侧栏浏览器的页面本体（移植官方 sidebar-browser 的 client/view/BrowserBody.tsx）：载体 + 缩略图遮罩。
// 工具栏/地址栏在 BrowserToolbar.tsx，查找条在 BrowserFindBar.tsx。
// 两支载体各自成为一个组件（壳内/纯浏览器不会中途切换，选择在渲染分支上做），所以这里不条件调用 hook。
//
// 两种尺寸（官方是"面板里一个 tab"；本仓按用户定稿把它做成同一实例的两种呈现）：
//   slot     —— 面板里的缩略图：只有载体，外加一层点击展开的遮罩（点它不操作网页）
//   expanded —— 工具栏 + 占满面板的页面（人可以直接操作）
// 两种尺寸共用同一个组件实例，所以切尺寸不会重挂载体、不会丢页面状态。

import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { t } from "../i18n";
import { useIframeBrowser } from "./useIframeBrowser";
import { useNativeBrowser } from "./useNativeBrowser";
import { BrowserEmpty, IframeCarrier, NativeCarrier, browserCarrierKind } from "./BrowserCarrier";
import { BrowserFindBar } from "./BrowserFindBar";
import { BrowserTabStrip } from "./BrowserTabStrip";
import { BrowserToolbar } from "./BrowserToolbar";
import { BrowserBlankPage } from "./BrowserBlankPage";
import { AddressField } from "./BrowserAddressField";
import type { PaneFace } from "./useIframeBrowser";

/** 缩略图下面那行说明（图 2 的 "<名字>'s screen"）。 */
function ScreenCaption({ text }: { text: string }) {
  return <div className="panel-browser-caption">{text}</div>;
}

/** 缩略图态的遮罩：点它展开，不把点击透给网页。 */
function SlotOverlay({ label, onExpand }: { label: string; onExpand: () => void }) {
  return (
    <button type="button" className="panel-browser-veil" aria-label={label} data-tip={label} onClick={onExpand}>
      <Maximize2 size={16} />
    </button>
  );
}

/** 壳载体：页面由壳里的 WKWebView 承载。展开态把槽位挖给壳的原生视图（人在这里操作）；
 *  缩略图态显示壳给的**快照图**——WKWebView 没法"缩小放进去"（pageZoom 是重新排版，
 *  见 BrowserHost.previewShot），缩略图要的是整屏的等比缩小。 */
function NativeBrowserPane({ expanded, applicationOrigin, onExpand, onChat, caption }: {
  expanded: boolean;
  applicationOrigin: string;
  onExpand: () => void;
  onChat: () => void;
  caption: string;
}) {
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findTick, setFindTick] = useState(0);
  const [intent, setIntent] = useState<{ kind: "address" | "find"; id: number }>({ kind: "address", id: 0 });
  // 壳转来的浏览器快捷键（焦点在网页里时 SPA 收不到键）
  const browser = useNativeBrowser(applicationOrigin, (key) => {
    if (key === "address") setIntent((prev) => ({ kind: "address", id: prev.id + 1 }));
    else if (key === "find") { setFindOpen(true); setFindTick((t) => t + 1); }
    else if (key === "findNext") stepFind(true, findQuery);
    else if (key === "findPrevious") stepFind(false, findQuery);
    else if (key === "reload") browser.doReload();
    else if (key === "back") browser.goBack();
    else if (key === "forward") browser.goForward();
    else if (key === "zoomIn") browser.zoomIn();
    else if (key === "zoomOut") browser.zoomOut();
    else if (key === "zoomReset") browser.zoomReset();
  }, !expanded);
  const face: PaneFace = {
    ...browser.frame, draft: browser.draft, setDraft: browser.setDraft, failure: browser.failure,
    submit: browser.submit, navigate: browser.navigate,
    goBack: browser.goBack, goForward: browser.goForward, doReload: browser.doReload,
  };
  const empty = browser.frame.address === "";

  // 空串在这条链路上是"取消查找并清选区"（壳侧 find 的约定），所以清空输入要真的发出去，
  // 否则页面上还留着上一次的高亮。
  const stepFind = (forward: boolean, query: string) => {
    browser.find(query.trim() === "" ? "" : query, forward);
  };
  const closeFind = () => {
    setFindOpen(false);
    setFindQuery("");
    browser.find("");   // 空串 = 取消查找并清选区
  };
  const external = browser.frame.address === "unknown" ? undefined : browser.frame.target?.url;
  return (
    <div className={`panel-browser${expanded ? " expanded" : " slot"}`}>
      {expanded && (
        <BrowserTabStrip
          face={face}
          tabs={browser.tabs}
          activeId={browser.activeTabId}
          onSelect={browser.selectTab}
          onClose={browser.closeTab}
          onNew={browser.newTab}
          onPick={(url) => browser.navigate(url)}
          focusTick={intent.kind === "address" ? intent.id : 0}
          onMute={browser.toggleMute}
          trailing={(
            <BrowserToolbar
              face={face}
              external={external}
              onChat={onChat}
              zoom={{ value: browser.zoom, zoomIn: browser.zoomIn, zoomOut: browser.zoomOut, zoomReset: browser.zoomReset }}
              shield={{ paused: browser.shieldPaused, toggle: browser.toggleShield }}
              reader={{ on: browser.reader, toggle: browser.toggleReader }}
              hidden={{ count: browser.hiddenCount, picking: browser.picking, togglePick: browser.togglePicking, restore: browser.restoreHidden }}
              bookmark={{ on: browser.bookmarked, toggle: browser.toggleBookmark }}
              onFind={() => { setFindOpen(true); setFindTick((t) => t + 1); }}
            />
          )}
        />
      )}
      {expanded && findOpen && (
        <BrowserFindBar
          query={findQuery}
          setQuery={setFindQuery}
          found={browser.findResult?.found ?? null}
          onStep={stepFind}
          onClose={closeFind}
          focusTick={findTick}
        />
      )}
      <div className="panel-browser-body">
        {expanded ? (
          <>
            {/* 唤醒期间铺的停帧图：页面一有像素，压在上面的原生视图就把它盖住了，
                所以这里不需要"页面画好了"的回执，壳给时限撤图（BrowserTab.wake） */}
            {browser.cover !== "" && (
              <img className="panel-browser-cover" src={`data:image/png;base64,${browser.cover}`} alt="" />
            )}
            {/* 拾取模式：提示人点哪个（页面里那圈高亮由壳注入的脚本画） */}
            {browser.picking && <div className="panel-browser-hint">{t("点页面上的元素把它从此站隐藏（Esc 取消）")}</div>}
            {/* 空白标签页：整屏空白 + 居中那块大输入框（参考 Omnibox 站在空标签上的样子） */}
            {empty && (
              <BrowserBlankPage face={face} onPick={(url) => browser.navigate(url)} />
            )}
            <NativeCarrier interactive>{null}</NativeCarrier>
          </>
        ) : (
          <>
            {empty && <BrowserEmpty />}
            {!empty && browser.shot !== null && (
              <img className="sr-browser-shot" src={`data:image/png;base64,${browser.shot}`} alt={browser.title || caption} />
            )}
            {/* 遮罩装在槽位外面：缩略图态这格是快照图（不是原生视图），遮罩要盖在图上 */}
            <SlotOverlay label={t("展开浏览器")} onExpand={onExpand} />
          </>
        )}
      </div>
      {!expanded && <ScreenCaption text={caption} />}
    </div>
  );
}

/** iframe 载体：跨域读不到地址，所以自带"应用自有历史 + 未知地址"状态机。 */
function IframeBrowserPane({ expanded, applicationOrigin, onExpand, onChat, caption }: {
  expanded: boolean;
  applicationOrigin: string;
  onExpand: () => void;
  onChat: () => void;
  caption: string;
}) {
  const browser = useIframeBrowser(applicationOrigin);
  const [sandboxed, setSandboxed] = useState(true);
  const face: PaneFace = {
    ...browser.frame, draft: browser.draft, setDraft: browser.setDraft, failure: browser.failure,
    submit: browser.submit, goBack: browser.goBack, goForward: browser.goForward, doReload: browser.doReload,
  };
  const target = browser.frame.target;
  return (
    <div className={`panel-browser${expanded ? " expanded" : " slot"}`}>
      {/* iframe 载体（纯浏览器那一支）没有标签模型：它只画行尾那组工具，不画标签行 */}
      {expanded && (
        <div className="panel-browser-chrome">
          <div className="panel-browser-chrome-field">
            <AddressField face={face} onPick={(url) => { face.setDraft(url); face.submit(); }} />
          </div>
          <BrowserToolbar
            face={face}
            onChat={onChat}
            sandbox={{ enabled: sandboxed, toggle: () => setSandboxed((v) => !v) }}
          />
        </div>
      )}
      <div className="panel-browser-body">
        {target === undefined
          ? <BrowserEmpty />
          : <IframeCarrier
              url={target.url}
              revision={browser.revision}
              title={target.title}
              onLoad={browser.loaded}
              onError={browser.failed}
            />}
        {!expanded && <SlotOverlay label={t("展开浏览器")} onExpand={onExpand} />}
      </div>
      {!expanded && <ScreenCaption text={caption} />}
    </div>
  );
}

/** 侧栏浏览器（对外入口）：按载体选一支，两种尺寸由调用方给。 */
export function BrowserPane({ expanded, applicationOrigin, onExpand, onChat, caption }: {
  expanded: boolean;
  applicationOrigin: string;
  onExpand: () => void;
  onChat: () => void;
  caption: string;
}) {
  return browserCarrierKind() === "native"
    ? <NativeBrowserPane expanded={expanded} applicationOrigin={applicationOrigin} onExpand={onExpand} onChat={onChat} caption={caption} />
    : <IframeBrowserPane expanded={expanded} applicationOrigin={applicationOrigin} onExpand={onExpand} onChat={onChat} caption={caption} />;
}
