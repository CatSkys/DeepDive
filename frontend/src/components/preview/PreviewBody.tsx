// 预览体：一个文件路径 → 渲染面。按扩展名分流（图片/PDF/HTML 直出，
// Markdown 走富文本，代码等文本走等宽面板），二进制误入文本面时引导外部打开。
// 内容一律经引擎受控面 /api/file?path=…（同源经桥），不管「谁打开」。

import { useEffect, useState } from "react";
import { t } from "../../i18n";
import { Markdown } from "../Markdown";
import { fileUrlOf, previewKindOf, type PreviewKind } from "./previewKind";

export function PreviewBody({ path }: { path: string }) {
  const kind: PreviewKind = previewKindOf(path);
  const name = path.split("/").pop() ?? "";
  if (kind === "image") return <img className="preview-media" src={fileUrlOf(path)} alt={name} />;
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
