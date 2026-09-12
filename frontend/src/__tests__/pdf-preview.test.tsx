// PDF 预览的渲染网眼：pdfjs 在 jsdom 里跑不动（真 worker + canvas），因此 mock
// pdfjs-dist，只钉装配与失败路径——逐页容器、进视口才渲染（jsdom 无
// IntersectionObserver，故只有首页渲染）、加载失败给「重试」并重新拉取。
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getDocument: vi.fn(), renders: [] as number[], renders2: [] as number[] }));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: h.getDocument,
}));

import { PdfPreview } from "../components/preview/PdfPreview";

// jsdom 不实现 scrollIntoView（记忆页落点）与 canvas 2D 上下文（pdf.js 绘制面），
// 各补一个空实现——真渲染由浏览器侧验证
Element.prototype.scrollIntoView = vi.fn();
HTMLCanvasElement.prototype.getContext = (() => ({})) as unknown as typeof HTMLCanvasElement.prototype.getContext;

afterEach(() => {
  cleanup();
  h.getDocument.mockReset();
  h.renders.length = 0;
});

function fakeDoc(numPages: number) {
  return {
    numPages,
    getPage: async (n: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
      render: () => {
        h.renders.push(n);
        return { promise: Promise.resolve(), cancel: () => {} };
      },
    }),
  };
}

function fakeTask(doc: unknown) {
  return { promise: Promise.resolve(doc), destroy: vi.fn(async () => {}) };
}

describe("PDF 预览", () => {
  it("逐页建容器，仅首页立即渲染（其余等进视口）", async () => {
    h.getDocument.mockReturnValue(fakeTask(fakeDoc(3)));
    render(<PdfPreview path="/w/a.pdf" page={1} />);
    await waitFor(() => expect(document.querySelectorAll(".pdf-page")).toHaveLength(3));
    await waitFor(() => expect(h.renders).toEqual([1]));
    // 画布按 devicePixelRatio 定尺寸（jsdom 里 dpr=1 → 视口原尺寸）
    const canvas = document.querySelector<HTMLCanvasElement>(".pdf-canvas")!;
    expect(canvas.width).toBe(612);
    expect(canvas.height).toBe(792);
    expect(document.querySelectorAll(".pdf-page-hold")).toHaveLength(2); // 未渲染页占位
  });

  it("加载失败给出原因与「重试」，重试重新拉取", async () => {
    h.getDocument.mockReturnValue({ promise: Promise.reject(new Error("boom")), destroy: vi.fn(async () => {}) });
    render(<PdfPreview path="/w/b.pdf" />);
    await screen.findByText("无法在应用内预览该文件");
    expect(screen.getByText("boom")).not.toBeNull();
    fireEvent.click(screen.getByText("重试"));
    // 动态导入 + 重新拉取是异步的
    await waitFor(() => expect(h.getDocument).toHaveBeenCalledTimes(2));
  });

  it("资产与文件都走同源 URL（不落 CDN）", async () => {
    h.getDocument.mockReturnValue(fakeTask(fakeDoc(1)));
    render(<PdfPreview path="/w/c.pdf" />);
    await waitFor(() => expect(h.getDocument).toHaveBeenCalled());
    const args = h.getDocument.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.url).toBe("/api/file?path=%2Fw%2Fc.pdf");
    expect(args.cMapUrl).toBe("/pdfjs/cmaps/");
    expect(args.standardFontDataUrl).toBe("/pdfjs/standard_fonts/");
    expect(args.wasmUrl).toBe("/pdfjs/wasm/");
  });
});
