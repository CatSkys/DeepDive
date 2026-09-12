// 预览体：一个标签 → 渲染面。按选中的渲染器分流（图片/PDF/HTML 直出、
// Markdown 富文本、代码走带行号的代码卡、纯文本走带行号的等宽面），二进制
// 误入文本面时引导外部打开。内容一律经引擎受控面 /api/file?path=…（同源经桥）。
// 跳行（line）只作用于有行号的代码/纯文本渲染器：目标行进视口并加亮。

import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import { CodeLines } from "../CodeLines";
import { Markdown } from "../Markdown";
import { fileUrlOf, languageOf, type PreviewRenderer } from "./previewModel";

export function PreviewBody({ path, renderer, wrap, line, onOpenFile }: {
  path: string;
  renderer: PreviewRenderer;
  wrap: boolean;
  /** 跳行落点（1 起）；未指定不滚动。 */
  line?: number;
  /** Markdown 内本地文件链接的落点（开新标签 / 跳到该行）。 */
  onOpenFile?: (path: string, line?: number) => void;
}) {
  const name = path.split("/").pop() ?? "";
  if (renderer === "image") return <img className="preview-media" src={fileUrlOf(path)} alt={name} />;
  if (renderer === "pdf") return <iframe className="preview-frame" src={fileUrlOf(path)} title={path} />;
  if (renderer === "html") return <iframe className="preview-frame" sandbox="" src={fileUrlOf(path)} title={path} />;
  if (renderer === "markdown") return <MarkdownText path={path} onOpenFile={onOpenFile} />;
  return <TextPreview path={path} lang={renderer === "code" ? languageOf(path) : ""} wrap={wrap} line={line} card={renderer === "code"} />;
}

/** Markdown 富文本：拉一次内容后走应用内渲染（图可点开放大）。 */
function MarkdownText({ path, onOpenFile }: { path: string; onOpenFile?: (path: string, line?: number) => void }) {
  const state = useText(path);
  if (state === null) return <div className="preview-loading">{t("加载中…")}</div>;
  if ("error" in state) return <TextFailure detail={state.error} />;
  return <div className="preview-md"><Markdown text={state.text} onOpenFile={onOpenFile} /></div>;
}

/** 代码 / 纯文本：带行号（lang 为空不着色），可选折行与跳行落点。 */
function TextPreview({ path, lang, wrap, line, card }: {
  path: string;
  lang: string;
  wrap: boolean;
  line?: number;
  /** true = 代码卡（.cb 铬件，含语言头与复制）；false = 贴面板的纯文本。 */
  card: boolean;
}) {
  const state = useText(path);
  const boxRef = useRef<HTMLDivElement | null>(null);
  // 跳行：内容就位后把目标行滚到视口中间（对齐官方 lineTarget 的落点行为）
  useEffect(() => {
    if (line === undefined) return;
    boxRef.current?.querySelector<HTMLElement>(".cbRow[data-target]")?.scrollIntoView({ block: "center" });
  }, [line, state]);
  if (state === null) return <div className="preview-loading">{t("加载中…")}</div>;
  if ("error" in state) return <TextFailure detail={state.error} />;
  // 二进制误入文本面：NUL 哨兵即引导外部打开
  if (state.text.includes("\u0000")) {
    return (
      <div className="preview-fallback">
        <p>{t("该文件类型不支持应用内预览")}</p>
      </div>
    );
  }
  const lines = state.text.split("\n");
  if (!card) {
    return (
      <div ref={boxRef} className="preview-text" data-wrap={wrap ? "" : undefined}>
        <CodeLines lines={lines} lang={lang} target={line} />
      </div>
    );
  }
  return (
    <div className="cb preview-code" data-wrap={wrap ? "" : undefined}>
      <div className="cbHead">
        <span className="cbFile">
          <span className="cbLang">{lang || t("纯文本")}</span>
        </span>
        <CopyButton text={state.text} />
      </div>
      <div ref={boxRef} className="cbBody">
        <CodeLines lines={lines} lang={lang} target={line} />
      </div>
    </div>
  );
}

/** 代码卡右上的复制（与消息流代码卡同款，无图标以免与卡片语言标签混排）。 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="cbCopy"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          },
          () => void 0, // 剪贴板不可用（权限/焦点缺失）：跳过反馈
        );
      }}
    >
      {copied ? t("已复制") : t("复制")}
    </button>
  );
}

function TextFailure({ detail }: { detail: string }) {
  return (
    <div className="preview-fallback">
      <p>{t("无法在应用内预览该文件")}</p>
      <p className="preview-fallback-detail">{detail}</p>
    </div>
  );
}

/** 拉一次文本内容（错误/加载态由调用方渲染）。 */
function useText(path: string): { text: string } | { error: string } | null {
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
  return state;
}
