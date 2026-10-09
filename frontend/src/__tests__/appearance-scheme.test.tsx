// 页面明暗的来源（2026-10-09 用户报"切成浅色模式：窗口浅了、卡片还是暗的，侧栏白字
// 压在浅玻璃上像空的"）：壳把外观三态设在 `webView.appearance` 上，WebKit 把它报成
// prefers-color-scheme——这是页面明暗的本地基准，丢不掉；壳的 themeChanged / prefs
// 推送只作同值确认（那是一次 evaluateJavaScript，漏投就没有第二次）。
// 钉三件：①壳一次都没推时页面也按这个媒体查询上色；②它运行时翻转即时跟随
// （= 壳改 appearance）；③壳的推送仍然生效，载荷畸形不猜测。
// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installHostBridge } from "../host";
import { usePrefs } from "../prefs";

/** 可控的 matchMedia：只有 prefers-color-scheme 那条会被翻，其余恒 false（同 jsdom 现状）。 */
let darkMatches = true;
const schemeListeners = new Set<() => void>();

beforeAll(() => {
  window.matchMedia = ((query: string) => {
    const scheme = query.includes("prefers-color-scheme");
    return {
      get matches() { return scheme ? darkMatches : false; },
      media: query,
      onchange: null,
      addEventListener: (type: string, cb: () => void) => {
        if (scheme && type === "change") schemeListeners.add(cb);
      },
      removeEventListener: (type: string, cb: () => void) => {
        if (scheme && type === "change") schemeListeners.delete(cb);
      },
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as unknown as typeof window.matchMedia;
  delete window.__deepDiveHost;
  installHostBridge();
});

/** 壳改 webView.appearance → WebKit 翻这条查询并触发 change。 */
function flipScheme(dark: boolean) {
  darkMatches = dark;
  act(() => { for (const cb of schemeListeners) cb(); });
}

function Probe() {
  const { schemeDark } = usePrefs();
  return <span>{schemeDark ? "dark" : "light"}</span>;
}

const theme = () => document.documentElement.getAttribute("data-theme");

describe("页面明暗的来源", () => {
  beforeEach(() => {
    darkMatches = true;
    schemeListeners.clear();
    document.documentElement.removeAttribute("data-theme");
  });
  afterEach(cleanup);

  it("壳一次都没推：首帧就按媒体查询上色", () => {
    darkMatches = false;
    render(<Probe />);
    expect(theme()).toBe("light");
  });

  it("壳改 appearance 后即使推送丢了，页面也跟着翻", () => {
    render(<Probe />);
    expect(theme()).toBe("dark");
    flipScheme(false);
    expect(theme()).toBe("light");
  });

  it("壳的 themeChanged 推送仍然生效（同值确认）", () => {
    darkMatches = false;
    render(<Probe />);
    act(() => window.__deepDiveHost!.dispatch("themeChanged", { dark: true }));
    expect(theme()).toBe("dark");
  });

  it("themeChanged 载荷畸形就忽略，不猜成暗色", () => {
    darkMatches = false;
    render(<Probe />);
    act(() => window.__deepDiveHost!.dispatch("themeChanged", {}));
    expect(theme()).toBe("light");
  });
});
