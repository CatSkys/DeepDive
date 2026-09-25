// 侧栏浏览器的页面本体（移植官方 sidebar-browser 的 client/view/BrowserBody.tsx）：
// 工具栏五钮 + 地址栏 + 载体。两支载体各自成为一个组件，工具栏共用——这样不必在组件里
// 条件调用 hook（壳内/纯浏览器不会中途切换，选择在渲染分支上做）。
//
// 两种尺寸（官方是"面板里一个 tab"；本仓按用户定稿把它做成同一实例的两种呈现）：
//   slot     —— 面板里的缩略图：只有载体，外加一层点击展开的遮罩（点它不操作网页）
//   expanded —— 工具栏 + 占满面板的页面（人可以直接操作）
// 两种尺寸共用同一个组件实例，所以切尺寸不会重挂载体、不会丢页面状态。

import { useState } from "react";
import { ChevronLeft, ChevronRight, RotateCw, CornerUpRight, ShieldOff, ShieldCheck, Maximize2 } from "lucide-react";
import { t } from "../i18n";
import { openExternalUrl } from "../host";
import type { BrowserAddressFailure } from "./browserUrl";
import type { BrowserFrameState } from "./useIframeBrowser";
import { useIframeBrowser } from "./useIframeBrowser";
import { useNativeBrowser } from "./useNativeBrowser";
import { BrowserEmpty, IframeCarrier, NativeCarrier, browserCarrierKind } from "./BrowserCarrier";

/** 地址被拒的原因 → 用户可见文案（官方 error.* 一组）。 */
function failureText(reason: BrowserAddressFailure): string {
  if (reason === "empty") return t("请输入地址");
  if (reason === "protocol") return t("只支持 http/https 地址");
  if (reason === "credentials") return t("地址里不能带用户名或密码");
  if (reason === "application-origin") return t("不能打开 DeepDive 自己的地址");
  return t("地址无效");
}

interface PaneFace extends BrowserFrameState {
  draft: string;
  setDraft: (v: string) => void;
  failure: BrowserAddressFailure | undefined;
  submit: () => void;
  goBack: () => void;
  goForward: () => void;
  doReload: () => void;
}

/** 工具栏 + 地址栏（官方 BrowserBody 的 form 部分）。 */
function BrowserToolbar({ face, sandbox }: {
  face: PaneFace;
  /** 只有 iframe 载体给得出沙箱开关；原生载体由壳执行策略，不给这个按钮。 */
  sandbox?: { enabled: boolean; toggle: () => void };
}) {
  const unknown = face.address === "unknown";
  const external = unknown ? undefined : face.target?.url;
  return (
    <form className="panel-browser-toolbar" onSubmit={(e) => { e.preventDefault(); face.submit(); }}>
      <button type="button" className="panel-browser-tool" aria-label={t("后退")} data-tip={t("后退")}
        disabled={!face.canGoBack} onClick={face.goBack}>
        <ChevronLeft size={15} />
      </button>
      <button type="button" className="panel-browser-tool" aria-label={t("前进")} data-tip={t("前进")}
        disabled={!face.canGoForward} onClick={face.goForward}>
        <ChevronRight size={15} />
      </button>
      <button type="button" className="panel-browser-tool" aria-label={t("刷新")} data-tip={t("刷新")}
        disabled={face.target === undefined} onClick={face.doReload}>
        <RotateCw size={13} />
      </button>
      <div className="panel-browser-address-box">
        <input
          className={`panel-browser-address${unknown ? " unknown" : ""}`}
          value={face.draft}
          aria-label={t("地址")}
          placeholder={t("输入地址")}
          spellCheck={false}
          onChange={(e) => face.setDraft(e.currentTarget.value)}
        />
        {unknown && <span className="panel-browser-changed">{t("页面已跳转，地址未知")}</span>}
        <button type="submit" className="panel-browser-tool" aria-label={t("打开")} data-tip={t("打开")}>
          <CornerUpRight size={14} />
        </button>
      </div>
      <button type="button" className="panel-browser-tool" aria-label={t("在浏览器中打开")} data-tip={t("在浏览器中打开")}
        disabled={external === undefined} onClick={external === undefined ? undefined : () => openExternalUrl(external)}>
        <CornerUpRight size={14} />
      </button>
      {sandbox && (
        <button
          type="button"
          className={`panel-browser-tool${sandbox.enabled ? "" : " off"}`}
          aria-label={sandbox.enabled ? t("关闭沙箱") : t("开启沙箱")}
          data-tip={sandbox.enabled ? t("关闭沙箱") : t("开启沙箱")}
          aria-pressed={!sandbox.enabled}
          onClick={sandbox.toggle}
        >
          {sandbox.enabled ? <ShieldCheck size={13} /> : <ShieldOff size={13} />}
        </button>
      )}
      {face.failure !== undefined && <span className="panel-browser-note bad">{failureText(face.failure)}</span>}
      {face.error && <span className="panel-browser-note bad">{t("页面加载失败")}</span>}
    </form>
  );
}

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

/** 壳载体：页面由壳里的 WKWebView 承载（缩略图态让壳把这一格设成不收点击）。 */
function NativeBrowserPane({ expanded, applicationOrigin, onExpand, caption }: {
  expanded: boolean;
  applicationOrigin: string;
  onExpand: () => void;
  caption: string;
}) {
  const browser = useNativeBrowser(applicationOrigin);
  const face: PaneFace = {
    ...browser.frame, draft: browser.draft, setDraft: browser.setDraft, failure: browser.failure,
    submit: browser.submit, goBack: browser.goBack, goForward: browser.goForward, doReload: browser.doReload,
  };
  const empty = browser.frame.address === "";
  return (
    <div className={`panel-browser${expanded ? " expanded" : " slot"}`}>
      {expanded && <BrowserToolbar face={face} />}
      <div className="panel-browser-body">
        {/* 遮罩装在槽位**里面**：它是"点开面板"的点击靶，不该把自己的槽位判成被盖住
            （那会让壳把原生视图藏起来，缩略图里就看不到页面了）。 */}
        {empty
          ? <BrowserEmpty />
          : (
            <NativeCarrier interactive={expanded}>
              {!expanded && <SlotOverlay label={t("展开浏览器")} onExpand={onExpand} />}
            </NativeCarrier>
          )}
      </div>
      {!expanded && <ScreenCaption text={caption} />}
    </div>
  );
}

/** iframe 载体：跨域读不到地址，所以自带"应用自有历史 + 未知地址"状态机。 */
function IframeBrowserPane({ expanded, applicationOrigin, onExpand, caption }: {
  expanded: boolean;
  applicationOrigin: string;
  onExpand: () => void;
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
      {expanded && <BrowserToolbar face={face} sandbox={{ enabled: sandboxed, toggle: () => setSandboxed((v) => !v) }} />}
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
export function BrowserPane({ expanded, applicationOrigin, onExpand, caption }: {
  expanded: boolean;
  applicationOrigin: string;
  onExpand: () => void;
  caption: string;
}) {
  return browserCarrierKind() === "native"
    ? <NativeBrowserPane expanded={expanded} applicationOrigin={applicationOrigin} onExpand={onExpand} caption={caption} />
    : <IframeBrowserPane expanded={expanded} applicationOrigin={applicationOrigin} onExpand={onExpand} caption={caption} />;
}
