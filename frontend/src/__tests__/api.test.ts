// RPC 唯一入口的线路契约（0.1.2）：斜杠端点 + {args} 具名包裹 + 信封 method
// 与端点一致（PITFALLS §4.6）、waterfall 应答（$events/result）、能力探测
// 降级（铁律 4）。fetch 全程 mock。
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, probeMethod } from "../api";
import { mux } from "../mux";

type Envelope = { type: string; rpcId: string; method: string; payload: unknown };

function lastCall(): { url: string; envelope: Envelope } {
  const mock = vi.mocked(fetch);
  const args = mock.mock.calls[mock.mock.calls.length - 1];
  const [url, init] = args as unknown as [string, RequestInit];
  return { url: String(url), envelope: JSON.parse(String(init.body)) as Envelope };
}

function respond(value: unknown, ok = true) {
  return () => new Response(JSON.stringify({ rpcId: "r", result: { ok, value } }), { status: 200 });
}

function failWith(status: number, code?: string, message?: string) {
  return () => new Response(
    status >= 400 && !code ? "err" : JSON.stringify({ rpcId: "r", result: { ok: false, error: { code, message } } }),
    { status },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("unary 信封", () => {
  it("POST 斜杠路径 + client-request 信封 + {args} 包裹；rpcId 必须是非空字符串", async () => {
    vi.stubGlobal("fetch", vi.fn(respond({ items: [] })));
    await api.sessions();
    const { url, envelope } = lastCall();
    expect(url).toBe("/api/session/list");
    expect(envelope.type).toBe("client-request");
    expect(envelope.method).toBe("session/list"); // 必须与端点字符串一致
    expect(envelope.payload).toEqual({ args: { _request: {} } }); // list 的保留参数 _request 必须显式出现
    expect(typeof envelope.rpcId).toBe("string");
    expect(envelope.rpcId.length).toBeGreaterThan(0);
  });

  it("page 具名参数经 {args} 包裹（throughSeq 取自 follow 开窗帧）", async () => {
    vi.stubGlobal("fetch", vi.fn(respond({ records: [], hasMore: false })));
    await api.page({ address: { kind: "session", sessionId: "s1" }, throughSeq: 100, beforeSeq: 42, maxMessages: 120 });
    const { url, envelope } = lastCall();
    expect(url).toBe("/api/session/page");
    expect((envelope.payload as { args: unknown }).args).toEqual({
      request: { address: { kind: "session", sessionId: "s1" }, throughSeq: 100, beforeSeq: 42, maxMessages: 120 },
    });
  });

  it("设置面写操作：单对象参数必须包在具名 request 里，不是摊平在 args 上", async () => {
    // 引擎的 typert 网关按**形参名**取字段（实测 pluginInventory/patchSet 摊平会报
    // missing "request" / unexpected "rowId"），这里把四个写口与一个读口的形状钉死。
    vi.stubGlobal("fetch", vi.fn(respond({ ok: true })));
    const argsOf = () => (lastCall().envelope.payload as { args: unknown }).args;

    await api.pluginPatchSet("hmr", true);
    expect(lastCall().url).toBe("/api/pluginInventory/patchSet");
    expect(argsOf()).toEqual({ request: { rowId: "hmr", disabled: true } });

    await api.skillsAdmin.create("n", "d");
    expect(lastCall().url).toBe("/api/skills/adminCreate");
    expect(argsOf()).toEqual({ request: { name: "n", description: "d" } });

    await api.skillsAdmin.remove("n");
    expect(argsOf()).toEqual({ request: { id: "n" } });

    await api.skillsAdmin.install("/tmp/x");
    expect(argsOf()).toEqual({ request: { sourceDirectory: "/tmp/x" } });

    await api.skillsAdmin.list();
    expect(lastCall().url).toBe("/api/skills/adminList");
    expect(argsOf()).toEqual({});
  });

  it("result.ok=false 抛 code: message；HTTP 非 2xx 抛 transport 错", async () => {
    vi.stubGlobal("fetch", vi.fn(failWith(200, "bad-request", "invalid client-request message")));
    await expect(api.cancel({ sessionId: "s" })).rejects.toThrow("bad-request: invalid client-request message");
    vi.stubGlobal("fetch", vi.fn(failWith(500)));
    await expect(api.cancel({ sessionId: "s" })).rejects.toThrow("HTTP 500");
  });

  it("fork 携带 atSeq；search 扁平 query（4.1，引擎禁用部署上 reject 由调用方降级）", async () => {
    vi.stubGlobal("fetch", vi.fn(respond({ sessionId: "child" })));
    await api.fork({ sessionId: "s", atSeq: 42 });
    expect((lastCall().envelope.payload as { args: unknown }).args).toEqual({ request: { sessionId: "s", atSeq: 42 } });
    vi.stubGlobal("fetch", vi.fn(failWith(200, "SESSION_QUERY_SEARCH_DISABLED", "session search is disabled")));
    await expect(api.search({ query: "abc" })).rejects.toThrow("SESSION_QUERY_SEARCH_DISABLED");
    vi.stubGlobal("fetch", vi.fn(respond({ items: [{ sessionId: "s", snippet: "…" }], hasMore: false })));
    await api.search({ query: "abc" });
    expect(lastCall().url).toBe("/api/session/search");
    expect((lastCall().envelope.payload as { args: unknown }).args).toEqual({ request: { query: "abc" } });
  });
});

describe("waterfall 应答（$events/result）", () => {
  // clientId 由 $events ready 帧设置在 mux 单例上；测试直接注入世代身份钉
  // HTTP 形状（URL + 信封 method + outcome 值）。
  const armGeneration = (clientId: string | undefined) => {
    // 世代身份由 $events ready 帧设置在 mux 单例上；测试经同一消费路径注入
    //（挂一个订阅触发开流，再从单例持有的 ws 上喂一帧 ready）。
    vi.stubGlobal("WebSocket", class {
      readyState = 1; onopen: (() => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null; onerror: (() => void) | null = null;
      sent: string[] = [];
      send(d: unknown) { this.sent.push(String(d)); }
      close() { this.onclose?.(); }
      static OPEN = 1; static CLOSED = 3;
    });
    if (clientId === undefined) return;
    mux.onEvents({});
    const wsHolder = mux as unknown as { ws: { onmessage: ((e: { data: string }) => void) | null } };
    wsHolder.ws.onmessage?.({ data: JSON.stringify({ type: "item", streamId: "$$events", value: { type: "ready", clientId, host: { home: "/h" } } }) });
  };

  it("answerApproval 以 result 值回官方 ApprovalDecision 字面量", async () => {
    armGeneration("gen-1");
    vi.stubGlobal("fetch", vi.fn(respond({})));
    await api.answerApproval("ev-1", "allowed-once");
    const { url, envelope } = lastCall();
    expect(url).toBe("/api/$events/result");
    expect(envelope.method).toBe("$events/result");
    expect((envelope.payload as { args: { clientId: string; eventId: string; outcome: unknown } }).args).toEqual({
      clientId: "gen-1", eventId: "ev-1", outcome: { kind: "result", value: "allowed-once" },
    });
  });

  it("cancelQuestion 以 rejected + code=cancelled 结算", async () => {
    armGeneration("gen-2");
    vi.stubGlobal("fetch", vi.fn(respond({})));
    await api.cancelQuestion("ev-2");
    const args = (lastCall().envelope.payload as { args: { outcome: unknown } }).args;
    expect(args.outcome).toEqual({ kind: "rejected", error: { name: "Error", message: "cancelled by user", code: "cancelled" } });
  });

  it("无 $events 世代时显式失败（不静默丢应答）", async () => {
    armGeneration(undefined);
    // 断线即弃世代：喂一帧 close 清空 clientId（onclose → eventClientId=undefined）
    const wsHolder = mux as unknown as { ws: { onclose: (() => void) | null } };
    wsHolder.ws.onclose?.();
    await expect(api.cancelQuestion("ev-3")).rejects.toThrow("no active generation");
  });
});

describe("probeMethod 能力探测", () => {
  it("404 → 方法不存在", async () => {
    vi.stubGlobal("fetch", vi.fn(failWith(404)));
    await expect(probeMethod("session.modelCatalog")).resolves.toBe(false);
  });

  it("gateway 不可用类错误码 → 方法不存在", async () => {
    vi.stubGlobal("fetch", vi.fn(failWith(200, "gateway/invocation-unavailable", "no such route")));
    await expect(probeMethod("session.modelCatalog")).resolves.toBe(false);
  });

  it("参数类错误（方法存在、空载荷不合法）→ true", async () => {
    vi.stubGlobal("fetch", vi.fn(failWith(200, "invalid-request", "args required")));
    await expect(probeMethod("settings.mutate")).resolves.toBe(true);
  });
});

describe("session/follow 帧解包（SessionEventEntry）", () => {
  // 引擎 SessionFollowFrame = snapshot | SessionEventEntry；
  // SessionEventEntry = {type:'event', event: SessionEvent}（types.ts:382）。
  // 曾把 live 帧多剥一层（frame.event.event）→ onEvent(undefined) 被 mux
  // 吞掉，快照正常、直播正文永空白（2026-09-10 实机钉死）。
  it("live 帧 onEvent 收到 SessionEvent 本体，snapshot 走 onSnapshot", () => {
    const sockets: Array<{
      readyState: number;
      onmessage: ((e: { data: string }) => void) | null;
      sent: string[];
    }> = [];
    vi.stubGlobal("WebSocket", class {
      readyState = 1; onopen: (() => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null; onerror: (() => void) | null = null;
      sent: string[] = [];
      constructor() { sockets.push(this); queueMicrotask(() => this.onopen?.()); }
      send(d: unknown) { this.sent.push(String(d)); }
      close() { /* keep open for feed */ }
      static OPEN = 1; static CLOSED = 3;
    });
    const snaps: unknown[] = [];
    const evs: Array<{ type: string; seq: number }> = [];
    // 强制单例换到本用例的 socket 桩（旧 ws 可能仍 OPEN，openStream 会直接复用）。
    mux.recycle();
    api.followSession(
      { kind: "session", sessionId: "s-follow" },
      {
        onSnapshot: (s) => snaps.push(s.cursor),
        onEvent: (ev) => evs.push({ type: ev.type, seq: ev.seq ?? -1 }),
      },
    );
    const ws = sockets[sockets.length - 1]!;
    const open = ws.sent.map((s) => JSON.parse(s) as { type: string; endpoint?: string; streamId?: string })
      .find((f) => f.type === "open" && f.endpoint === "session/follow");
    expect(open?.streamId).toBeTruthy();
    const streamId = open!.streamId!;
    const feed = (value: unknown) => {
      ws.onmessage?.({ data: JSON.stringify({ type: "item", streamId, value }) });
    };
    feed({
      type: "snapshot", header: { id: "s-follow" }, cursor: 5, hasMore: false,
      records: [{ type: "event", event: { type: "turn/start", seq: 4, time: 1, data: { turn: 1 } } }],
      projections: { asOfSeq: 5, values: {} },
    });
    feed({ type: "event", event: { type: "user/message", seq: 7, time: 2, data: { content: [{ type: "text", text: "hi" }], source: { kind: "user" }, role: "user", id: "u" } } });
    feed({ type: "event", event: { type: "turn/end", seq: 8, time: 3, data: { turn: 1, reason: { kind: "completed" } } } });
    expect(snaps).toEqual([5]);
    expect(evs).toEqual([
      { type: "user/message", seq: 7 },
      { type: "turn/end", seq: 8 },
    ]);
  });
});
