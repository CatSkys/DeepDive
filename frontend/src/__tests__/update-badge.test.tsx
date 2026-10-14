// @vitest-environment jsdom
// 标题栏那颗「有更新待装」钮与它的 hover 说明卡（components/UpdateBadge.tsx）。
// 壳推 `updateState` 这条路走真的桥（installHostBridge + dispatch）——不用 mock，
// 因为它就是这一屏的输入面；只有 store 要 mock（useT 读语言，宿主不在）。
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installHostBridge } from "../host";
import { UpdateBadge, formatReleaseDate } from "../components/UpdateBadge";

vi.mock("../store", () => ({ useStore: () => ({ lang: "zh" }) }));

beforeEach(() => {
  delete (window as { __deepDiveHost?: unknown }).__deepDiveHost;
  installHostBridge();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

/** 壳推一条更新状态（与 AppDelegate.pushUpdateState 同一个事件名与载荷）。 */
function pushUpdate(payload: Record<string, unknown>) {
  act(() => window.__deepDiveHost!.dispatch("updateState", {
    currentVersion: "0.1.1", readyVersion: null, readyDate: null, readyNotes: null,
    canUpdate: true, ...payload,
  }));
}

const badge = () => document.querySelector<HTMLButtonElement>(".update-badge");
const card = () => document.querySelector(".update-card");

describe("formatReleaseDate", () => {
  it("按语言排成长期日期格式", () => {
    // 只钉形状不钉具体日子：Intl 按**系统时区**排版，写死日子会在别的时区上红。
    expect(formatReleaseDate("2026-10-14T01:04:50Z", "zh")).toMatch(/^\d{4}年\d{1,2}月\d{1,2}日$/);
    expect(formatReleaseDate("2026-10-14T01:04:50Z", "en")).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
  });

  it("认不出来给空串（卡片就不显示日期那一行，不显示 Invalid Date）", () => {
    expect(formatReleaseDate("", "zh")).toBe("");
    expect(formatReleaseDate("不知道什么格式", "zh")).toBe("");
  });
});

describe("UpdateBadge", () => {
  it("没有待装更新时什么都不渲染", () => {
    render(<UpdateBadge />);
    expect(badge()).toBeNull();
    pushUpdate({ readyVersion: null });
    expect(badge()).toBeNull();
  });

  it("载荷畸形就当没收到（不摆一颗来路不明的钮）", () => {
    render(<UpdateBadge />);
    act(() => window.__deepDiveHost!.dispatch("updateState", { currentVersion: 123 }));
    expect(badge()).toBeNull();
  });

  it("待装时冒出那颗钮，hover 出卡：版本 + 日期 + 说明正文", () => {
    render(<UpdateBadge />);
    pushUpdate({
      readyVersion: "0.1.2",
      readyDate: "2026-10-14T01:04:50Z",
      readyNotes: "## 本版变更\n\n- 接入自动更新，见 [发布仓](https://example.com/r)",
    });
    const btn = badge();
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("aria-label")).toBe("已下载 0.1.2");

    // 没 hover 之前不该有卡（它是 hover 出来的浮层）
    expect(card()).toBeNull();
    act(() => { fireEvent.mouseEnter(btn!); });
    expect(card()).not.toBeNull();

    const text = card()!.textContent ?? "";
    expect(text).toContain("已下载 0.1.2");
    expect(text).toContain("本版变更");
    expect(text).toContain("重启以安装");
    // 日期那一行在（内容按时区而异，只钉"有这一行"）
    expect(document.querySelector(".update-card-date")?.textContent).toBeTruthy();
    // 说明里的链接真的渲染成链接（Markdown 管线，不是纯文本）
    expect(card()!.querySelector("a")?.getAttribute("href")).toBe("https://example.com/r");
  });

  it("没拉到说明时卡片仍可用：只有版本与动作，没有正文那一段", () => {
    render(<UpdateBadge />);
    pushUpdate({ readyVersion: "0.1.2" });
    act(() => { fireEvent.mouseEnter(badge()!); });
    expect(card()).not.toBeNull();
    expect(document.querySelector(".update-card-notes")).toBeNull();
    expect(card()!.textContent).toContain("已下载 0.1.2");
    expect(card()!.textContent).toContain("重启以安装");
  });

  it("指针离开钮就收（延时可取消：进卡不算离开）", async () => {
    render(<UpdateBadge />);
    pushUpdate({ readyVersion: "0.1.2" });
    const btn = badge()!;
    act(() => { fireEvent.mouseEnter(btn); });
    expect(card()).not.toBeNull();

    // 离开钮 → 延时关闭（120ms）；延时期内进卡 → 取消，卡留着。
    act(() => { fireEvent.mouseLeave(btn); });
    act(() => { fireEvent.mouseEnter(card()!); });
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(card()).not.toBeNull();

    // 从卡上离开 → 到点收（延时 120ms + 离场动画收尾 150ms，给足 1.5s）。
    act(() => { fireEvent.mouseLeave(card()!); });
    await waitFor(() => expect(card()).toBeNull(), { timeout: 1500 });
  });
});
