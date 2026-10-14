// 命令中心卡的 Esc 语义（用户 2026-10-14 两轮报"仍然无法 esc 返回，esc 就悬浮面板就直接
// 消失了"）：**翻到第二层（模型页）按 Esc 是返回根行**，只有根行才收卡；认下的键一律
// preventDefault（WKWebView 里页面不管的 Esc 会沿 responder chain 变成窗口的
// cancelOperation，浏览器里量不出来——PITFALLS §10.5）。
// 这条同时钉住"面板页拿着键盘"那条回路：壳转来的 miniCCEscape 必须走卡页自己同一套语义。
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const close = vi.fn();

vi.mock("../store", () => ({
  useStore: () => ({ keybinds: {}, lang: "zh", pinned: new Set<string>() }),
}));
vi.mock("../api", () => ({ api: { commandExecute: async () => ({}) } }));
vi.mock("../settings/useSettingNamespace", () => ({
  SettingsConflictError: class SettingsConflictError extends Error {},
  useSettingNamespace: () => ({ describe: async () => undefined, update: async () => {} }),
}));
// 目录两份、同一个厂商：模型页就是"一段选项列表"那张选择页（Esc 要在这上面生效）
vi.mock("../useDraftModelFace", () => ({
  useDraftModelFace: () => ({
    face: {
      models: [
        { provider: "deepseek", model: "deepseek-v4", label: "DeepSeek V4", providerLabel: "DeepSeek" },
        { provider: "deepseek", model: "deepseek-v3", label: "DeepSeek V3", providerLabel: "DeepSeek" },
      ],
      currentModel: { provider: "deepseek", model: "deepseek-v4" },
      pickModel: () => {},
    },
    reloadModels: () => {},
  }),
}));

import { MiniCommandCenter } from "../minipanel/MiniCommandCenter";
import { installHostBridge } from "../host";

/** 整页 keydown 的 Esc（卡里"焦点不在搜索框"那一路）：目标就是 body，与真机一致。 */
function escFromPage(): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => { document.body.dispatchEvent(ev); });
  return ev;
}

const onModelPage = () => document.querySelector(".mini-cc-choice") !== null;
const onRootRows = () => document.querySelector(".mini-cc-settings") !== null;

async function openModelPage() {
  const row = await screen.findByText(/更换模型/);
  act(() => { fireEvent.click(row); });
  expect(onModelPage()).toBe(true);
}

beforeEach(() => {
  close.mockClear();
  installHostBridge({});
});
afterEach(cleanup);

describe("命令中心：Esc 的语义归卡页", () => {
  it("根行按 Esc = 收卡（认下的键要 preventDefault）", async () => {
    render(<MiniCommandCenter mode="settings" sessionId={null} onClose={close} />);
    await screen.findByText(/更换模型/);
    const ev = escFromPage();
    expect(close).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("翻到模型页再按 Esc = 回根行，不收卡", async () => {
    render(<MiniCommandCenter mode="settings" sessionId={null} onClose={close} />);
    await openModelPage();
    const ev = escFromPage();
    expect(close).not.toHaveBeenCalled();
    expect(onModelPage()).toBe(false);
    expect(onRootRows()).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    // 回到根行后收卡这条路仍在（不能把"唯一的回路"修没了）
    escFromPage();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("壳转来的 miniCCEscape（键盘其实在面板页手里）走同一条语义", async () => {
    render(<MiniCommandCenter mode="settings" sessionId={null} onClose={close} />);
    await openModelPage();
    act(() => { window.__deepDiveHost!.dispatch("miniCCEscape", {}); });
    expect(close).not.toHaveBeenCalled();
    expect(onModelPage()).toBe(false);
    expect(onRootRows()).toBe(true);
    act(() => { window.__deepDiveHost!.dispatch("miniCCEscape", {}); });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("选中即回写并退回根行（Esc 之外的那条回路照旧）", async () => {
    render(<MiniCommandCenter mode="settings" sessionId={null} onClose={close} />);
    await openModelPage();
    act(() => { fireEvent.click(screen.getByText("DeepSeek V3")); });
    expect(onModelPage()).toBe(false);
    expect(onRootRows()).toBe(true);
    expect(close).not.toHaveBeenCalled();
  });
});
