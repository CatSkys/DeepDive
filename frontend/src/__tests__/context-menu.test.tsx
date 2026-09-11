// 消息流右键菜单的渲染网眼：产物 chip（data-file-ctx）右键 → 文件动作、
// 无锚点右键只压原生菜单不弹条、输入框内不拦截、点动作后收起。
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionActions } from "../components/SelectionActions";

afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-file-ctx]").forEach((n) => n.remove());
});

/** 造一个带 data-file-ctx 的产物 chip 并挂进文档（右键走 document 委托）。 */
function chip(path: string): HTMLElement {
  const el = document.createElement("button");
  el.setAttribute("data-file-ctx", path);
  document.body.appendChild(el);
  return el;
}

const items = () =>
  [...document.querySelectorAll(".sel-actions button")].map((b) => b.textContent);

describe("消息流右键菜单", () => {
  it("产物 chip 上右键给「默认应用打开 / 在 Finder 中显示」", () => {
    render(<SelectionActions />);
    fireEvent.contextMenu(chip("/w/a.txt"), { clientX: 40, clientY: 80 });
    expect(items()).toEqual(["默认应用打开", "在 Finder 中显示"]);
  });

  it("无锚点右键只压掉原生菜单，不弹条", () => {
    render(<SelectionActions />);
    const prevented = fireEvent.contextMenu(document.body, { clientX: 10, clientY: 10 });
    expect(prevented).toBe(false); // preventDefault 已调用 → 原生菜单不出
    expect(items()).toEqual([]);
  });

  it("输入框内右键不拦截（原生编辑菜单保留）", () => {
    render(<SelectionActions />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(fireEvent.contextMenu(input)).toBe(true);
    expect(items()).toEqual([]);
    input.remove();
  });

  it("点「默认应用打开」把 chip 的绝对路径交给壳，并收起菜单", async () => {
    const post = vi.fn();
    (window as unknown as { webkit?: unknown }).webkit = { messageHandlers: { deepdiveHost: { postMessage: post } } };
    render(<SelectionActions />);
    fireEvent.contextMenu(chip("/w/a.txt"), { clientX: 40, clientY: 80 });
    // 浮条 portal 到 body（不在 RTL 容器内）：点击进 act 才同步提交
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".sel-actions button")!.click();
    });
    expect(post).toHaveBeenCalledWith({ type: "open-path", path: "/w/a.txt" });
    expect(items()).toEqual([]);
    delete (window as unknown as { webkit?: unknown }).webkit;
  });
});
