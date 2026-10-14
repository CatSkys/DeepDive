// 附件在**输入框内部**（用户 2026-10-14 定稿）：胶囊排在编辑器之前、住在 `.composer`
// 里，不再另起一行摆在胶囊外面。这里钉住那个结构（谁把它挪回胶囊外面，这里立刻红），
// 以及从粘贴到摘除这条最小链路。
// 预览开在下方还是上方是几何（要真排版），归 UI-SPEC 与真机；画面元素本身由
// attachment-pill.test.tsx 钉。
// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// jsdom 里没有的几样（与 composer-overlay.test.tsx 同一套理由与配方）
beforeAll(() => {
  if (!globalThis.localStorage) {
    const map = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, String(v)); },
      removeItem: (k: string) => { map.delete(k); },
      clear: () => { map.clear(); },
      key: (i: number) => [...map.keys()][i] ?? null,
      get length() { return map.size; },
    } as unknown as Storage;
  }
  // 折行判据要读那一格的实测高度（真排版不在 jsdom 里做，这里只补上接口）
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  }
  // store 初始化外观要 matchMedia
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

// 引擎面不在本测试里：会话表给空数组，其余原样透传（失败的调用由调用方各自的 catch 收）
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, api: { ...actual.api, sessions: vi.fn(async () => ({ items: [] })) } };
});

import { Composer } from "../components/Composer";
import { StoreProvider } from "../store";

/** 草稿页（无会话）：附件走本地字节那条路，不碰引擎；档位表空 → 不带档位胶囊。 */
const EFFORT = { levels: [], value: undefined, pick: () => {} };

/** 挂真 Provider（与 composer-overlay.test.tsx 同一条路）：store 自带轮询，引擎面由
 *  上面的 api mock 兜住。 */
function renderComposer() {
  return render(<StoreProvider><Composer sessionId={null} effort={EFFORT} /></StoreProvider>);
}

afterEach(cleanup);

/** 往输入框里粘一张图片（macOS 惯例的 ⌘V 那条路）。 */
async function pasteImage(container: HTMLElement, name = "shot.png") {
  const ta = container.querySelector<HTMLTextAreaElement>(".composer-field textarea")!;
  fireEvent.paste(ta, { clipboardData: { files: [new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" })] } });
  await waitFor(() => expect(container.querySelector(".att-chip")).not.toBeNull());
}

describe("输入框里的附件胶囊", () => {
  it("住在输入胶囊里、排在编辑器之前（不在胶囊外面另起一行）", async () => {
    const { container } = renderComposer();
    await pasteImage(container);
    expect(container.querySelector(".composer .composer-field .composer-atts .att-chip")).not.toBeNull();
    // 胶囊外面（wrap/anchor 的直接子元素）不能再有附件
    expect(container.querySelector(".composer-wrap > .att-chip, .composer-anchor > .att-chip")).toBeNull();
    const atts = container.querySelector(".composer-atts")!;
    const text = container.querySelector(".composer-field textarea")!;
    // 顺序：胶囊在前、输入框在后（DOM 序即视觉序）
    expect(atts.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("媒体悬停出预览画面；移除钮把胶囊摘掉", async () => {
    const { container } = renderComposer();
    await pasteImage(container);
    expect(container.querySelector(".att-preview")).toBeNull();
    fireEvent.mouseEnter(container.querySelector(".att-chip")!);
    expect(container.querySelector(".att-preview img")).not.toBeNull();
    fireEvent.click(container.querySelector(".att-chip-x")!);
    expect(container.querySelector(".att-chip")).toBeNull();
  });

  it("内容高过一行就进宽态（＋ 与右簇换到底部行，不再垂直居中在整块框里）", async () => {
    // jsdom 不排版：文本列那一格的实测高度只能自己钉——判据就是"它比单行高"
    // （用户 2026-10-14 报障：附件把框撑高后 ＋/发送钮居中在框中间）。
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      // 只在真有附件时算"高过一行"（68），空框给 0——单行高的参照值来自 CSS
      // （jsdom 不加载样式表，`min-height` 读出来是空串→0，所以这里不能给空框
      // 也报一个正数，否则"空框恒等于单行高"这条前提在钉子里被钉反）。
      get(this: HTMLElement) {
        return this.classList.contains("composer-field") && this.querySelector(".composer-atts") ? 68 : 0;
      },
    });
    try {
      const { container } = renderComposer();
      await pasteImage(container);
      await waitFor(() => expect(container.querySelector(".composer.wide")).not.toBeNull());
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "clientHeight", original);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
    }
  });
});
