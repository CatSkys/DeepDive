// 右侧文件预览 Dock（上游 ui-sidebar-documentpreview 的单屏极简移植）：
// 多标签、按扩展名分流渲染（图片/PDF/HTML 直出，Markdown 走富文本，
// 代码等文本走等宽面板），每标签带「默认应用打开 / Finder 定位」动作；
// 支持左缘拖拽调宽、全屏模式、分栏双预览（§1 Sidebar 增强）。
// 内容一律经引擎受控面 /api/file?path=…（同源经桥）。状态由 usePreviewDock
// 持有（SessionView 装配），本模块不管「谁打开文件」。

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FolderSearch, Maximize2, Minimize2, SplitSquareHorizontal, X } from "lucide-react";
import { t } from "../../i18n";
import { openPath, revealPath } from "../../host";
import { Markdown } from "../Markdown";
import { fileUrlOf, previewKindOf, type PreviewKind } from "./previewKind";

export interface PreviewTab {
  path: string;
  name: string;
}

/** Dock 宽度夹取范围（px）。 */
const DOCK_MIN = 280;
const DOCK_MAX = 720;
const DOCK_DEFAULT = 400;

/** 从 localStorage 读持久化宽度（损坏/越界回默认）。 */
function loadWidth(): number {
  const raw = localStorage.getItem("deepdive.previewW");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= DOCK_MIN && n <= DOCK_MAX ? Math.round(n) : DOCK_DEFAULT;
}

export function usePreviewDock() {
  const [tabs, setTabs] = useState<PreviewTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [width, setWidth] = useState(loadWidth);
  const [fullscreen, setFullscreen] = useState(false);
  /** 分栏 pane 的路径（null = 未分栏）；与主 pane 同标签集。 */
  const [splitPath, setSplitPath] = useState<string | null>(null);

  const open = useCallback((path: string) => {
    setTabs((prev) => (prev.some((x) => x.path === path) ? prev : [...prev, { path, name: path.split("/").pop() ?? path }]));
    setActivePath(path);
  }, []);

  const close = useCallback((path: string) => {
    setTabs((prev) => {
      const next = prev.filter((x) => x.path !== path);
      setActivePath((cur) => (cur === path ? next.at(-1)?.path ?? null : cur));
      setSplitPath((cur) => (cur === path ? null : cur));
      return next;
    });
  }, []);

  const setWidthPersist = useCallback((w: number) => {
    const clamped = Math.round(Math.min(DOCK_MAX, Math.max(DOCK_MIN, w)));
    setWidth(clamped);
    localStorage.setItem("deepdive.previewW", String(clamped));
  }, []);

  return {
    tabs, activePath, setActivePath, open, close,
    width, setWidthPersist,
    fullscreen, setFullscreen,
    splitPath, setSplitPath,
  };
}

/** 单个预览体：按扩展名分流；文本类拉一次内容。 */
function PreviewBody({ path }: { path: string }) {
  const kind: PreviewKind = previewKindOf(path);
  if (kind === "image") return <img className="preview-media" src={fileUrlOf(path)} alt={path.split("/").pop() ?? ""} />;
  if (kind === "pdf") return <iframe className="preview-frame" src={fileUrlOf(path)} title={path} />;
  if (kind === "html") return <iframe className="preview-frame" sandbox="" src={fileUrlOf(path)} title={path} />;
  return <TextPreview path={path} kind={kind} />;
}

function TextPreview({ path, kind }: { path: string; kind: PreviewKind }) {
  const [state, setState] = useState<{ text: string } | { error: string } | null>(null);
  useEffect(() => {
    let alive = true;
    setState(null);
    fetch(fileUrlOf(path))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => { if (alive) setState({ text }); })
      .catch((e: unknown) => {
        if (alive) setState({ error: e instanceof Error ? e.message : String(e) });
      });
    return () => { alive = false; };
  }, [path]);

  if (state === null) return <div className="preview-loading">{t("加载中…")}</div>;
  if ("error" in state) {
    return (
      <div className="preview-fallback">
        <p>{t("无法在应用内预览该文件")}</p>
        <p className="preview-fallback-detail">{state.error}</p>
      </div>
    );
  }
  // 二进制误入文本面：NUL 哨兵即引导外部打开
  if (state.text.includes("\u0000")) {
    return (
      <div className="preview-fallback">
        <p>{t("该文件类型不支持应用内预览")}</p>
      </div>
    );
  }
  return kind === "markdown"
    ? <div className="preview-md"><Markdown text={state.text} /></div>
    : <pre className="preview-code">{state.text}</pre>;
}

/** 一个预览 pane：标签条（可选分栏关闭钮）+ 工具栏 + 预览体。 */
function PreviewPane({ tabs, activePath, setActivePath, onCloseTab, split, fullscreen }: {
  tabs: PreviewTab[];
  activePath: string | null;
  setActivePath: (path: string) => void;
  onCloseTab: (path: string) => void;
  /** 本 pane 是否为分栏 pane。 */
  split?: boolean;
  fullscreen?: boolean;
}) {
  const active = tabs.find((x) => x.path === activePath) ?? tabs[tabs.length - 1];
  if (!active) return null;
  return (
    <div className="preview-pane" data-split={split || undefined} data-fullscreen={fullscreen || undefined}>
      <div className="preview-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.path}
            type="button"
            role="tab"
            aria-selected={tab.path === active.path}
            className="preview-tab"
            data-active={tab.path === active.path || undefined}
            title={tab.name}
            onClick={() => setActivePath(tab.path)}
          >
            <span className="preview-tab-name">{tab.name}</span>
            <span
              className="preview-tab-x"
              role="button"
              aria-label={t("关闭预览")}
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.path); }}
            >
              <X size={11} />
            </span>
          </button>
        ))}
      </div>
      <div className="preview-toolbar">
        <span className="preview-path" title={active.path}>{active.path}</span>
        <button type="button" className="preview-act" data-tip={t("默认应用打开")} onClick={() => openPath(active.path)}>
          <ExternalLink size={13} />
        </button>
        <button type="button" className="preview-act" data-tip={t("在 Finder 中显示")} onClick={() => revealPath(active.path)}>
          <FolderSearch size={13} />
        </button>
      </div>
      <PreviewBody key={active.path} path={active.path} />
    </div>
  );
}

export function FilePreviewDock({ tabs, activePath, setActivePath, onCloseTab, dock, onCloseTabTop }: {
  tabs: PreviewTab[];
  activePath: string | null;
  setActivePath: (path: string) => void;
  onCloseTab: (path: string) => void;
  /** usePreviewDock 返回的增强状态（宽度/全屏/分栏）。 */
  dock: {
    width: number;
    setWidthPersist: (w: number) => void;
    fullscreen: boolean;
    setFullscreen: (v: boolean) => void;
    splitPath: string | null;
    setSplitPath: (p: string | null) => void;
  };
  onCloseTabTop: (path: string) => void;
}) {
  if (tabs.length === 0) return null;
  // 拖拽调宽：左缘把手，pointer 捕获（起点宽度 + 位移，左拖=加宽）
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = dock.width;
    const move = (ev: PointerEvent) => dock.setWidthPersist(startW + (startX - ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const mainTabs = dock.splitPath !== null ? tabs.filter((x) => x.path !== dock.splitPath) : tabs;
  const splitTabs = dock.splitPath !== null ? tabs.filter((x) => x.path === dock.splitPath) : [];

  return (
    <aside
      className={`preview-dock${dock.fullscreen ? " fullscreen" : ""}`}
      style={{ width: dock.fullscreen ? undefined : dock.width }}
      aria-label={t("文件预览")}
    >
      {!dock.fullscreen && (
        <span className="preview-resizer" aria-hidden="true"
          onPointerDown={startDrag}
        />
      )}
      <div className="preview-dock-head">
        <button
          type="button"
          className="preview-act"
          data-tip={dock.fullscreen ? t("退出全屏") : t("全屏预览")}
          aria-label={dock.fullscreen ? t("退出全屏") : t("全屏预览")}
          onClick={() => dock.setFullscreen(!dock.fullscreen)}
        >
          {dock.fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
        <button
          type="button"
          className="preview-act"
          data-tip={dock.splitPath !== null ? t("关闭分栏") : t("分栏（同屏双预览）")}
          aria-label={dock.splitPath !== null ? t("关闭分栏") : t("分栏（同屏双预览）")}
          disabled={tabs.length < 2}
          onClick={() => dock.setSplitPath(dock.splitPath !== null ? null : activePath)}
        >
          <SplitSquareHorizontal size={13} />
        </button>
        <span className="preview-dock-spacer" />
        <button
          type="button"
          className="preview-act"
          data-tip={t("关闭全部预览")}
          aria-label={t("关闭全部预览")}
          onClick={() => { for (const x of tabs) onCloseTabTop(x.path); }}
        >
          <X size={13} />
        </button>
      </div>
      <div className="preview-panes">
        <PreviewPane
          tabs={mainTabs}
          activePath={dock.splitPath !== null ? (mainTabs.some((x) => x.path === activePath) ? activePath : mainTabs.at(-1)?.path ?? null) : activePath}
          setActivePath={setActivePath}
          onCloseTab={onCloseTab}
        />
        {dock.splitPath !== null && splitTabs.length > 0 && (
          <PreviewPane
            tabs={splitTabs}
            activePath={dock.splitPath}
            setActivePath={dock.setSplitPath}
            onCloseTab={onCloseTab}
            split
            fullscreen={dock.fullscreen}
          />
        )}
      </div>
    </aside>
  );
}
