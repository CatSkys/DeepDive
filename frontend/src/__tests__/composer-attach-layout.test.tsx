// 附件在**输入框内部**（用户 2026-10-14 定稿）：胶囊排在编辑器之前、住在 `.composer`
// 里，不再另起一行摆在胶囊外面。这里钉住那个结构（谁把它挪回胶囊外面，这里立刻红），
// 以及从粘贴到摘除这条最小链路。
// 预览开在下方还是上方是几何（要真排版），归 UI-SPEC 与真机；画面元素本身由
// attachment-pill.test.tsx 钉。
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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

import { DD_EVENTS, dispatchAppEvent } from "../events";
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

/** 往输入框里粘一张图片（macOS 惯例的 ⌘V 那条路）。
 *  文本层是 CodeMirror 的 contenteditable：粘贴由它自己的 DOM 处理器接（不是 React 合成事件），
 *  所以这里构造原生事件并把 clipboardData 挂上去。 */
async function pasteImage(container: HTMLElement, name = "shot.png") {
  const content = container.querySelector<HTMLElement>(".composer-field .cm-content")!;
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files: [new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" })] },
  });
  content.dispatchEvent(event);
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
    const editor = container.querySelector(".composer-field .composer-editor")!;
    // 顺序：胶囊在前、编辑器在后（DOM 序即视觉序）
    expect(atts.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    // 判据由编辑器自己量自己的排版报出（Composer 的 onOverflow）：jsdom 不排版，
    // 折行量不出来，但**多行内容**（doc.lines > 1）是编辑器自己知道的事实——
    // 走一次预填（整篇替换那条路）就能钉住"报高 → 展开"。
    const { container } = renderComposer();
    expect(container.querySelector(".composer.wide")).toBeNull();
    act(() => { dispatchAppEvent(DD_EVENTS.composerPrefill, { text: "第一行\n第二行" }); });
    await waitFor(() => expect(container.querySelector(".composer.wide")).not.toBeNull());
  });
});
