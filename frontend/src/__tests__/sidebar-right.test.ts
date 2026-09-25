// 右侧边栏的纯逻辑：地址允许表、导航状态机、面板状态转移、会话产物派生。
// 这四份都是移植官方 ui-sidebar-browser / ui-sidebar-right 的规则，测试逐条钉住规则本身
// （不是钉实现细节），所以它们换承载形式时这些用例仍然有效。

import { describe, expect, it } from "vitest";
import { MAX_BROWSER_URL_LENGTH, parseBrowserAddress } from "../sidebar-right/browserUrl";
import {
  back, canGoBack, canGoForward, currentTarget, emptyBrowserTabState, forward, frameLoaded,
  navigate, reload,
} from "../sidebar-right/browserNavigation";
import {
  collapse, emptySurface, expand, expandBrowser, setFullscreen, setMode, showSession, toggleExpanded,
} from "../sidebar-right/panelState";
import { mergeArtifacts, sessionArtifacts } from "../sidebar-right/sessionArtifacts";
import type { RenderItem } from "../session/renderModel";

const target = (url: string) => {
  const parsed = parseBrowserAddress(url);
  if (!parsed.ok) throw new Error("test target refused: " + url);
  return parsed.target;
};

describe("地址允许表（官方 browser/url.ts 的口径）", () => {
  it("空输入按 empty 拒", () => {
    expect(parseBrowserAddress("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("没有 scheme 的输入补 https", () => {
    const r = parseBrowserAddress("example.com/a?b=1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.target.kind).toBe("https");
      expect(r.target.url).toBe("https://example.com/a?b=1");
      expect(r.target.title).toBe("example.com");
    }
  });

  it("端口写法不会被误判成 scheme（example.com:8080）", () => {
    const r = parseBrowserAddress("example.com:8080/x");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.target.url).toBe("https://example.com:8080/x");
  });

  it("http/https 之外的 scheme 一律按 protocol 拒", () => {
    for (const bad of ["file:///etc/passwd", "data:text/html,<b>x</b>", "blob:https://a/b", "javascript:alert(1)", "about:config"]) {
      expect(parseBrowserAddress(bad)).toEqual({ ok: false, reason: "protocol" });
    }
  });

  it("带内嵌凭据的地址按 credentials 拒", () => {
    expect(parseBrowserAddress("https://user:pw@example.com")).toEqual({ ok: false, reason: "credentials" });
  });

  it("本应用自己的 origin 被拒（页面不能把自己嵌进自己）", () => {
    expect(parseBrowserAddress("http://127.0.0.1:5000/x", "http://127.0.0.1:5000")).toEqual({ ok: false, reason: "application-origin" });
    expect(parseBrowserAddress("http://127.0.0.1:5001/x", "http://127.0.0.1:5000").ok).toBe(true);
  });

  it("超长输入按 invalid 拒", () => {
    expect(parseBrowserAddress("https://a.com/" + "x".repeat(MAX_BROWSER_URL_LENGTH))).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("导航状态机（官方 BrowserNavigation）", () => {
  it("navigate 追加目标并丢掉前向分支", () => {
    let s = emptyBrowserTabState();
    s = navigate(s, target("https://a.com"));
    s = navigate(s, target("https://b.com"));
    s = back(s)!;
    expect(canGoForward(s)).toBe(true);
    s = navigate(s, target("https://c.com"));
    expect(s.entries.map((e) => e.url)).toEqual(["https://a.com/", "https://c.com/"]);
    expect(canGoForward(s)).toBe(false);
  });

  it("历史有 100 条上限", () => {
    let s = emptyBrowserTabState();
    for (let i = 0; i < 130; i++) s = navigate(s, target("https://a.com/" + i));
    expect(s.entries.length).toBe(100);
    expect(currentTarget(s)!.url).toBe("https://a.com/129");
  });

  it("首帧到 → known；再一次 load → unknown，且后退前进同时失效", () => {
    let s = navigate(emptyBrowserTabState(), target("https://a.com"));
    s = navigate(s, target("https://b.com"));
    const revision = s.request!.revision;
    expect(s.navigation.status).toBe("loading");
    s = frameLoaded(s, revision);
    expect(s.navigation.status).toBe("known");
    expect(canGoBack(s)).toBe(true);
    s = frameLoaded(s, revision);
    expect(s.navigation.status).toBe("unknown");
    expect(canGoBack(s)).toBe(false);
    expect(canGoForward(s)).toBe(false);
  });

  it("迟到的旧代次 load 不改状态", () => {
    const s = navigate(emptyBrowserTabState(), target("https://a.com"));
    const stale = s.request!.revision - 1;
    expect(frameLoaded(s, stale).navigation.status).toBe("loading");
  });

  it("reload 复用当前目标且没有目标时无操作", () => {
    expect(reload(emptyBrowserTabState())).toBeUndefined();
    const s = navigate(emptyBrowserTabState(), target("https://a.com"));
    const again = reload(s)!;
    expect(currentTarget(again)!.url).toBe("https://a.com/");
    expect(again.request!.revision).toBe(s.request!.revision + 1);
  });

  it("back/forward 在边界上无操作", () => {
    const s = navigate(emptyBrowserTabState(), target("https://a.com"));
    expect(back(s)).toBeUndefined();
    expect(forward(s)).toBeUndefined();
  });
});

describe("面板状态（官方 ui-sidebar-right 的规则）", () => {
  it("一个会话从收起且空开始；展开落在默认页（屏幕缩略图 + 能力分区）", () => {
    const s = expand(emptySurface());
    expect(s.open).toBe(true);
    expect(s.mode).toBe("session");
    expect(s.fullscreen).toBe(false);
  });

  it("收起连全屏与浏览器页一起收（不留一个全屏的空面板）", () => {
    const s = expandBrowser(emptySurface());
    expect(s.fullscreen).toBe(true);
    expect(collapse(s).fullscreen).toBe(false);
    expect(collapse(s).open).toBe(false);
    expect(collapse(s).mode).toBe("session");
  });

  it("toggle 在收起/展开之间来回", () => {
    const opened = toggleExpanded(emptySurface());
    expect(opened.open).toBe(true);
    expect(toggleExpanded(opened).open).toBe(false);
  });

  it("点缩略图展开浏览器：换页 + 进全屏", () => {
    const s = expandBrowser(emptySurface());
    expect(s.mode).toBe("browser");
    expect(s.fullscreen).toBe(true);
    expect(s.open).toBe(true);
  });

  it("从浏览器页退回默认页：呈现也跟着退回 push", () => {
    const s = showSession(expandBrowser(emptySurface()));
    expect(s.mode).toBe("session");
    expect(s.fullscreen).toBe(false);
    expect(s.open).toBe(true);
  });

  it("单独切全屏不改页", () => {
    const s = setFullscreen(setMode(expand(emptySurface()), "browser"), true);
    expect(s.mode).toBe("browser");
    expect(setFullscreen(s, false).mode).toBe("browser");
  });
});

describe("会话产物派生", () => {
  const tail = (produced: string[], presented: Array<{ path: string; description?: string }>, key: string) =>
    ({ key, kind: "turn-tail", produced, presented }) as unknown as RenderItem;

  it("presented 先入且带描述，produced 补漏", () => {
    const items = mergeArtifacts(["b.ts", "c.ts"], [{ path: "a.ts", description: "交付物" }], "/w");
    expect(items.map((i) => i.path)).toEqual(["/w/a.ts", "/w/b.ts", "/w/c.ts"]);
    expect(items[0]!.desc).toBe("交付物");
  });

  it("同路径只出现一次（presented 优先）", () => {
    const items = mergeArtifacts(["a.ts"], [{ path: "a.ts", description: "交付物" }], "/w");
    expect(items.length).toBe(1);
    expect(items[0]!.desc).toBe("交付物");
  });

  it("绝对路径不再拼 root", () => {
    expect(mergeArtifacts(["/abs/x.ts"], [], "/w")[0]!.path).toBe("/abs/x.ts");
  });

  it("跨轮按绝对路径去重，保留最后一次的描述、位置取首次出现", () => {
    const items = sessionArtifacts([
      tail(["a.ts"], [], "k1"),
      tail([], [{ path: "b.ts" }], "k2"),
      tail([], [{ path: "a.ts", description: "改过的描述" }], "k3"),
    ], "/w");
    expect(items.map((i) => i.path)).toEqual(["/w/a.ts", "/w/b.ts"]);
    expect(items[0]!.desc).toBe("改过的描述");
  });

  it("非 turn-tail 项不参与", () => {
    const other = { key: "x", kind: "assistant" } as unknown as RenderItem;
    expect(sessionArtifacts([other], "/w")).toEqual([]);
  });
});
