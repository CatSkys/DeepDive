// Widget 桥（rich/widgetBridge.ts）的契约钉子：媒体 URL 改写、桥注入的位置与
// 幂等性、父侧逐条校验（source 认身份、长度/协议/高度有界）。桥是唯一实现，
// 行为漂移在这里拦。
// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openExternalUrl } from "../host";
import { prepareWidgetHtml, resolveWidgetUrls, useWidgetBridge, widgetSandboxAttr } from "../rich/widgetBridge";
import { fillTemplate } from "../rich/ui/form";

vi.mock("../host", () => ({ openExternalUrl: vi.fn() }));
const openUrl = vi.mocked(openExternalUrl);

afterEach(() => {
  cleanup();
  openUrl.mockReset();
  vi.restoreAllMocks();
});

describe("resolveWidgetUrls", () => {
  it("/api/ 开头的引用补 origin，其余原样；无匹配返回原串", () => {
    const html = '<div><img src="/api/file?path=/w/a.png"><a href="/api/file?path=/w/b.md">x</a><video poster="/api/file?path=/w/p.jpg"><source src="/api/file?path=/w/v.mp4"></video><a href="https://e.com">y</a></div>';
    const out = resolveWidgetUrls(html, "http://127.0.0.1:64274");
    expect(out).toContain('src="http://127.0.0.1:64274/api/file?path=/w/a.png"');
    expect(out).toContain('href="http://127.0.0.1:64274/api/file?path=/w/b.md"');
    expect(out).toContain('poster="http://127.0.0.1:64274/api/file?path=/w/p.jpg"');
    expect(out).toContain('src="http://127.0.0.1:64274/api/file?path=/w/v.mp4"');
    expect(out).toContain('href="https://e.com"');
    expect(resolveWidgetUrls("<p>没有引用</p>", "http://x")).toBe("<p>没有引用</p>");
  });
});

describe("prepareWidgetHtml", () => {
  it("桥脚本注入 head；无 head 有 html 则注入 html 后；纯片段注入串首", () => {
    expect(prepareWidgetHtml("<html><head><title>t</title></head><body></body></html>", "http://x"))
      .toMatch(/^<html><head><script>/);
    expect(prepareWidgetHtml("<html><body>hi</body></html>", "http://x")).toMatch(/^<html><script>/);
    expect(prepareWidgetHtml("<div>hi</div>", "http://x")).toMatch(/^<script>/);
  });

  it("同一输入永远同一输出（srcDoc 稳定，iframe 不因重渲重载）", () => {
    const once = prepareWidgetHtml("<div>hi</div>", "http://x");
    expect(prepareWidgetHtml("<div>hi</div>", "http://x")).toBe(once);
  });
});

describe("widgetSandboxAttr（Agent 自声明权限）", () => {
  it("缺省只有 allow-scripts；meta 声明白名单内旗标照准", () => {
    expect(widgetSandboxAttr("<div>hi</div>")).toBe("allow-scripts");
    expect(widgetSandboxAttr('<meta name="dsh-perms" content="forms popups"><div>hi</div>'))
      .toBe("allow-scripts allow-forms allow-popups");
    // 重复声明去重
    expect(widgetSandboxAttr('<meta name="dsh-perms" content="forms forms"><div></div>'))
      .toBe("allow-scripts allow-forms");
    // 白名单外的名字丢弃
    expect(widgetSandboxAttr('<meta name="dsh-perms" content="camera geolocation"><div></div>'))
      .toBe("allow-scripts");
  });

  it("allow-same-origin 结构性剥除——声明了也不行（srcdoc 同源 = 沙箱逃逸）", () => {
    expect(widgetSandboxAttr('<meta name="dsh-perms" content="allow-same-origin"><div></div>'))
      .toBe("allow-scripts");
  });
});

describe("useWidgetBridge 父侧校验", () => {
  /** 挂一个最小宿主组件，返回伪造 iframe source 的派发入口。 */
  function mountBridge(handlers: { onSend?: (text: string) => void; onWidgetError?: (message: string) => void }) {
    const contentWindow = {} as Window;
    const ref = { current: { contentWindow } as unknown as HTMLIFrameElement };
    let lastHeight: number | null = null;
    function Host() {
      const h = useWidgetBridge(ref, handlers);
      lastHeight = h;
      return <iframe title="t" />;
    }
    render(<Host />);
    const post = (data: unknown, source: unknown = contentWindow) => {
      act(() => {
        // jsdom 的 MessageEvent.source 是只读 getter，只能在构造参数里给
        window.dispatchEvent(new MessageEvent("message", { data: data as object, source: source as Window | null }));
      });
    };
    return { post, lastHeight: () => lastHeight };
  }

  it("sendPrompt：本 iframe 的合法文本放行；越界/坏类型/别家 iframe 丢弃", () => {
    const onSend = vi.fn();
    const bridge = mountBridge({ onSend });
    bridge.post({ dsh: "sendPrompt", text: "用 3 人份重算" });
    expect(onSend).toHaveBeenCalledWith("用 3 人份重算");
    onSend.mockClear();
    bridge.post({ dsh: "sendPrompt", text: "" });
    bridge.post({ dsh: "sendPrompt", text: "x".repeat(2001) });
    bridge.post({ dsh: "sendPrompt", text: 42 });
    bridge.post({ dsh: "sendPrompt", text: "别处的 iframe" }, {} as Window);
    bridge.post("not an object");
    bridge.post({ dsh: "unknown" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("openLink：只放行 https（javascript:/http 明确丢弃）", () => {
    const bridge = mountBridge({});
    bridge.post({ dsh: "openLink", url: "javascript:alert(1)" });
    bridge.post({ dsh: "openLink", url: "http://insecure.com" });
    bridge.post({ dsh: "openLink", url: 42 });
    expect(openUrl).not.toHaveBeenCalled();
    bridge.post({ dsh: "openLink", url: "https://ok.com" });
    expect(openUrl).toHaveBeenCalledWith("https://ok.com");
  });

  it("resize：有界采纳（越界夹到 40..4000），非有限数丢弃", () => {
    const bridge = mountBridge({});
    bridge.post({ dsh: "resize", height: 300 });
    expect(bridge.lastHeight()).toBe(300);
    bridge.post({ dsh: "resize", height: 10 });
    expect(bridge.lastHeight()).toBe(40);
    bridge.post({ dsh: "resize", height: 99999 });
    expect(bridge.lastHeight()).toBe(4000);
    bridge.post({ dsh: "resize", height: Number.NaN });
    bridge.post({ dsh: "resize", height: "300" });
    expect(bridge.lastHeight()).toBe(4000);
  });

  it("error：本 iframe 的错误转发给 onWidgetError（模型可见性）", () => {
    const onWidgetError = vi.fn();
    const bridge = mountBridge({ onWidgetError });
    bridge.post({ dsh: "error", message: "SecurityError: localStorage" });
    expect(onWidgetError).toHaveBeenCalledWith("SecurityError: localStorage");
    onWidgetError.mockClear();
    bridge.post({ dsh: "error", message: "" });
    bridge.post({ dsh: "error", message: 42 });
    bridge.post({ dsh: "error", message: "别处的 iframe" }, {} as Window);
    expect(onWidgetError).not.toHaveBeenCalled();
  });
});

describe("fillTemplate", () => {
  it("按字段名替换 {{name}}；没出现的字段不参与", () => {
    expect(fillTemplate("请按 {{people}} 人份、含 {{taste}} 重算", { people: "3", taste: "素食" }))
      .toBe("请按 3 人份、含 素食 重算");
    expect(fillTemplate("固定文案", { people: "3" })).toBe("固定文案");
    expect(fillTemplate("{{missing}} 占位原样", { people: "3" })).toBe("{{missing}} 占位原样");
  });
});
