// PDF 预览（官方 ui-sidebar-documentpreview/pdf 的移植）：完整字节 → pdf.js 逐页
// canvas 自绘。要点对齐官方——
// ① 页面懒渲染：每页一个占位，进入视口（rootMargin 100%）才渲染，离开不回收；
// ② 渲染尺寸按 devicePixelRatio，取消走 AbortSignal（切页/关闭不写脏画布）；
// ③ 失败给「重试」，不静默空页；④ 记住最后可见页（按标签存，重开回到那一页）。
// 与官方的差异：worker 与资产（cMaps/标准字体/wasm）走本包同源 URL（构建时
// 拷进 dist/pdfjs/），不做 base64 内联——本应用有同源静态服务，且离线可用。
// 不用 iframe 的理由：面板内材质与行为自持，不依赖 WKWebView 自带阅读器。

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { t, tt } from "../../i18n";
import { fileUrlOf } from "./previewModel";

/** 资产同样源路径（scripts/copy-pdfjs-assets.mjs 拷进 dist/pdfjs/）。 */
const ASSETS = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
} as const;

type Load =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; doc: PDFDocumentProxy };

export function PdfPreview({ path, page, onPage }: {
  path: string;
  /** 上次可见页（1 起）；未记录则第 1 页。 */
  page?: number;
  /** 可见页变化回写（标签级记忆）。 */
  onPage?: (page: number) => void;
}) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    let task: { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> } | undefined;
    setLoad({ kind: "loading" });
    // pdfjs 按需加载：导入期会触碰 DOMMatrix/canvas 等浏览器对象，且体积可观
    // ——只有真的打开 PDF 才拉它（主 bundle 不带，jsdom 测试也不被拖崩）
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        if (!alive) return;
        task = pdfjs.getDocument({ url: fileUrlOf(path), ...ASSETS });
        setLoad({ kind: "ready", doc: await task.promise });
      } catch (error: unknown) {
        if (alive) setLoad({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => {
      alive = false;
      // 卸载即销毁加载任务（pdf.js 会连带终止 worker 侧解析）
      void task?.destroy();
    };
  }, [path, attempt]);

  if (load.kind === "loading") return <div className="preview-loading">{t("加载中…")}</div>;
  if (load.kind === "failed") {
    return (
      <div className="preview-fallback">
        <p>{t("无法在应用内预览该文件")}</p>
        <p className="preview-fallback-detail">{load.message}</p>
        <button type="button" className="preview-retry" onClick={() => setAttempt((n) => n + 1)}>{t("重试")}</button>
      </div>
    );
  }
  return (
    <div className="pdf-body">
      {Array.from({ length: load.doc.numPages }, (_, index) => (
        <PdfPage
          key={index}
          doc={load.doc}
          page={index + 1}
          first={index === 0}
          target={page ?? 1}
          onVisible={onPage}
        />
      ))}
    </div>
  );
}

/** 单页：进视口才渲染；跳页目标页挂载即渲染并把容器滚进视口。 */
function PdfPage({ doc, page, first, target, onVisible }: {
  doc: PDFDocumentProxy;
  /** 1 起的页号。 */
  page: number;
  first: boolean;
  /** 记忆页（首次挂载时滚到它）。 */
  target: number;
  onVisible?: (page: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [requested, setRequested] = useState(first);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const jumped = useRef(false);

  // 进入视口（含 100% 余量）才渲染；渲染过就不再观察
  useEffect(() => {
    const host = hostRef.current;
    if (!host || requested || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setRequested(true);
        observer.disconnect();
      }
    }, { rootMargin: "100% 0px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, [requested]);

  // 记忆页落点：内容就位后滚到那一页（只做一次，之后跟随用户滚动）
  useEffect(() => {
    if (jumped.current || page !== target || !hostRef.current) return;
    jumped.current = true;
    hostRef.current.scrollIntoView({ block: "start" });
  }, [page, target]);

  useEffect(() => {
    if (!requested) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let alive = true;
    let render: { cancel: () => void } | undefined;
    setState("loading");
    const run = async () => {
      try {
        const pdfPage: PDFPageProxy = await doc.getPage(page);
        if (!alive) return;
        const viewport = pdfPage.getViewport({ scale: 1 });
        const dpr = window.devicePixelRatio || 1;
        const scaled = pdfPage.getViewport({ scale: dpr });
        canvas.width = Math.floor(scaled.width);
        canvas.height = Math.floor(scaled.height);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas 2d context unavailable");
        const task = pdfPage.render({ canvas, canvasContext: ctx, viewport: scaled });
        render = task;
        await task.promise;
        if (alive) setState("ready");
      } catch (error: unknown) {
        if (alive) {
          setState("failed");
          setMessage(error instanceof Error ? error.message : String(error));
        }
      }
    };
    void run();
    return () => {
      alive = false;
      render?.cancel(); // 卸载/切页时取消：pdf.js 的取消会连带拒绝 promise，交由 alive 门控
    };
  }, [doc, page, requested, attempt]);

  // 可见页回写（标签级记忆）
  useEffect(() => {
    if (state !== "ready") return;
    onVisible?.(page);
  }, [state, page, onVisible]);

  return (
    <div ref={hostRef} className="pdf-page" data-page={page}>
      {state !== "ready" && (
        <div className="pdf-page-hold">
          {state === "failed"
            ? (
              <div className="preview-fallback">
                <p>{t("这一页渲染失败")}</p>
                <p className="preview-fallback-detail">{message}</p>
                <button type="button" className="preview-retry" onClick={() => setAttempt((n) => n + 1)}>{t("重试")}</button>
              </div>
            )
            : requested && <div className="preview-loading">{t("渲染中…")}</div>}
        </div>
      )}
      <canvas ref={canvasRef} className="pdf-canvas" hidden={state !== "ready"} role="img" aria-label={tt("PDF 第 {n} 页", "PDF page {n}", { n: page })} />
    </div>
  );
}
