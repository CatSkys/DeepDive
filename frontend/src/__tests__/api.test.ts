// RPC 唯一入口的线路契约：信封形状（PITFALLS §4.6 / §2.2）、翻页锚映射、
// 能力探测降级（铁律 4）、server-request 应答信封。fetch 全程 mock。
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, probeMethod } from "../api";

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
  it("POST 点形路径 + client-request 信封 + 扁平 payload；rpcId 必须是非空字符串", async () => {
    vi.stubGlobal("fetch", vi.fn(respond({ items: [] })));
    await api.sessions();
    const { url, envelope } = lastCall();
    expect(url).toBe("/api/session.list");
    expect(envelope.type).toBe("client-request");
    expect(envelope.method).toBe("session.list"); // 必须与路径派生名一致
    expect(envelope.payload).toEqual({});
    expect(typeof envelope.rpcId).toBe("string");
    expect(envelope.rpcId.length).toBeGreaterThan(0);
  });

  it("history 把调用方的 atSeq 映射为引擎的 beforeSeq（rc.2↔alpha.2 兼容层）", async () => {
    vi.stubGlobal("fetch", vi.fn(respond({ events: [], hasMore: false })));
    await api.history({ sessionId: "s1", atSeq: 42 });
    const { url, envelope } = lastCall();
    expect(url).toBe("/api/session.history");
    expect(envelope.payload).toEqual({ sessionId: "s1", beforeSeq: 42, maxMessages: undefined });
  });

  it("result.ok=false 抛 code: message；HTTP 非 2xx 抛 transport 错", async () => {
    vi.stubGlobal("fetch", vi.fn(failWith(200, "bad-request", "invalid client-request message")));
    await expect(api.cancel({ sessionId: "s" })).rejects.toThrow("bad-request: invalid client-request message");
    vi.stubGlobal("fetch", vi.fn(failWith(500)));
    await expect(api.cancel({ sessionId: "s" })).rejects.toThrow("HTTP 500");
  });
});

describe("server-request 应答", () => {
  it("answerApproval 原样回传 rpcId，value 为 {sessionId, approvalId, outcome}", async () => {
    vi.stubGlobal("fetch", vi.fn(respond({ accepted: true })));
    await api.answerApproval({ rpcId: "req-1", sessionId: "s", approvalId: "a1", outcome: "allowed-once" });
    const { url, envelope } = lastCall();
    const env = envelope as unknown as { type: string; rpcId: string; result: unknown };
    expect(url).toBe("/api/respond");
    expect(env.type).toBe("client-response");
    expect(env.rpcId).toBe("req-1"); // 换新 id 会被引擎 pending 表静默丢弃
    expect(env.result).toEqual({ ok: true, value: { sessionId: "s", approvalId: "a1", outcome: "allowed-once" } });
  });

  it("cancelQuestion 回 client-response 且 error.code=cancelled", async () => {
    vi.stubGlobal("fetch", vi.fn(respond({ accepted: true })));
    await api.cancelQuestion("req-2");
    const env = lastCall().envelope as unknown as { rpcId: string; result: { ok: boolean; error: { code: string } } };
    expect(env.rpcId).toBe("req-2");
    expect(env.result.ok).toBe(false);
    expect(env.result.error.code).toBe("cancelled");
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
