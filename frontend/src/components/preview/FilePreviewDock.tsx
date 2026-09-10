// 右侧文件预览 Dock（上游 ui-sidebar-documentpreview 的单屏极简移植）：
// 多标签、按扩展名分流渲染（图片/PDF/HTML 直出，Markdown 走富文本，
// 代码等文本走等宽面板），每标签带「默认应用打开 / Finder 定位」动作。
// 内容一律经引擎受控面 /api/file?path=…（同源经桥）。状态由 usePreviewDock
// 持有（SessionView 装配），本模块不管「谁打开文件」。

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FolderSearch, X } from "lucide-react";
import { t } from "../../i18n";
import { openPath, revealPath } from "../../host";
import { Markdown } from "../Markdown";
import { fileUrlOf, previewKindOf, type PreviewKind } from "./previewKind";

export interface PreviewTab {
  path: string;
  name: string;
}

export function usePreviewDock() {
  const [tabs, setTabs] = useState<PreviewTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);

  const open = useCallback((path: string) => {
    setTabs((prev) => (prev.some((x) => x.path === path) ? prev : [...prev, { path, name: path.split("/").pop() ?? path }]));
    setActivePath(path);
  }, []);

  const close = useCallback((path: string) => {
    setTabs((prev) => {
      const next = prev.filter((x) => x.path !== path);
      setActivePath((cur) => (cur === path ? next.at(-1)?.path ?? null : cur));
      return next;
    });
  }, []);

  return { tabs, activePath, setActivePath, open, close };
}

export function FilePreviewDock({ tabs, activePath, setActivePath, onCloseTab }: {
  tabs: PreviewTab[];
  activePath: string | null;
  setActivePath: (path: string) => void;
  onCloseTab: (path: string) => void;
}) {
  if (tabs.length === 0) return null;
  const active = tabs.find((x) => x.path === activePath) ?? tabs[tabs.length - 1];
  return (
    <aside className="preview-dock" aria-label={t("文件预览")}>
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
    </aside>
  );
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
