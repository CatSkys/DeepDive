// 消息反馈对象层语义钉（对照官方 ui-message-feedback controller）：
// ①一次 list 读种视图；②toggle 读已提交值——同评=delete 撤销、异评=put 改判、
// 冷视图点击也先落 list 再决策；③put/delete 带 ifVersion CAS，version-conflict
// 以回复 current 就地和解；④空备注保存=clearNote（rate 的 note 省略=保留）。
// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFeedback } from "../session/feedback";
import type { FeedbackItem } from "../session/feedback";

const item = (over: Partial<FeedbackItem>): FeedbackItem => ({
  messageId: "m1", rating: "positive", version: "v3", ...over,
});

// 工厂会被提升到文件顶，mock 句柄必须经 vi.hoisted 造；每测再配置实现。
const { listMock, putMock, delMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  putMock: vi.fn(),
  delMock: vi.fn(),
}));
vi.mock("../api", () => ({
  api: {
    feedbackList: listMock,
    feedbackPut: putMock,
    feedbackDelete: delMock,
  },
}));

/** 配置本轮桩：list 返回值/异常 + put/delete 缺省实现。 */
function stubApi(list: FeedbackItem[] | Error, putImpl?: () => Promise<unknown>, delImpl?: () => Promise<unknown>) {
  listMock.mockImplementation(async () => (list instanceof Error ? Promise.reject(list) : { items: list }));
  putMock.mockImplementation(putImpl ?? (async () => ({ ok: true, value: item({ version: "v4" }) })));
  delMock.mockImplementation(delImpl ?? (async () => ({ ok: true, value: null })));
  return { putMock, delMock, listMock };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function mount() {
  const { result } = renderHook(() => useFeedback("s1"));
  return result;
}

describe("useFeedback", () => {
  it("list 读种整份视图（一次调用种所有消息）", async () => {
    stubApi([item({ messageId: "a", rating: "positive" }), item({ messageId: "b", rating: "negative", version: "v7" })]);
    const r = await mount();
    act(() => r.current.ensure());
    await waitFor(() => expect(r.current.view.status).toBe("ready"));
    expect(r.current.view.items.get("a")?.rating).toBe("positive");
    expect(r.current.view.items.get("b")?.version).toBe("v7");
  });

  it("toggle 同评=delete 撤销，携带已观察 version", async () => {
    const { putMock, delMock } = stubApi([item({ rating: "positive", version: "v5" })]);
    const r = await mount();
    act(() => r.current.ensure());
    await waitFor(() => expect(r.current.view.status).toBe("ready"));
    await act(async () => { await r.current.toggle("m1", "positive"); });
    expect(putMock).not.toHaveBeenCalled();
    expect(delMock).toHaveBeenCalledWith({ sessionId: "s1", messageId: "m1", ifVersion: "v5" });
    await waitFor(() => expect(r.current.view.items.has("m1")).toBe(false));
  });

  it("toggle 异评=put 改判；冷视图点击先落 list 再按存储值决策", async () => {
    const { putMock, delMock } = stubApi([item({ rating: "negative", version: "v2" })]);
    const r = await mount();
    // 冷视图直接点 👍：controller 语义=先 list 再决策（存储是 negative → put 改判）
    await act(async () => { await r.current.toggle("m1", "positive"); });
    expect(putMock).toHaveBeenCalledWith(expect.objectContaining({ rating: "positive", ifVersion: "v2" }));
    expect(delMock).not.toHaveBeenCalled();
    await waitFor(() => expect(r.current.view.items.get("m1")?.rating).toBe("positive"));
  });

  it("put 的 version-conflict 以回复 current 就地和解", async () => {
    const authoritative = item({ rating: "negative", version: "v9" });
    stubApi(
      [],
      vi.fn(async () => ({ ok: false, error: { code: "version-conflict", current: authoritative } })),
    );
    const r = await mount();
    act(() => r.current.ensure());
    await waitFor(() => expect(r.current.view.status).toBe("ready"));
    const settled = await act(async () => r.current.toggle("m1", "positive"));
    expect(settled).toEqual({ ok: false, code: "version-conflict" });
    expect(r.current.view.items.get("m1")).toEqual(authoritative);
  });

  it("空备注保存=clearNote（put 显式无 note），非空=改判带 note", async () => {
    const { putMock } = stubApi([item({ rating: "positive", note: "旧备注", version: "v1" })]);
    const r = await mount();
    act(() => r.current.ensure());
    await waitFor(() => expect(r.current.view.status).toBe("ready"));
    await act(async () => { await r.current.clearNote("m1"); });
    expect(putMock).toHaveBeenCalledWith(expect.objectContaining({ rating: "positive", ifVersion: "v1" }));
    expect(putMock).toHaveBeenCalledWith(expect.not.objectContaining({ note: expect.anything() }));
    await act(async () => { await r.current.rate("m1", "positive", "新备注"); });
    expect(putMock).toHaveBeenLastCalledWith(expect.objectContaining({ note: "新备注" }));
  });
});
