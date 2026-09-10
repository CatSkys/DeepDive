// mux 假死自愈（开流应答看门狗）：WKWebView 系统睡眠后 WS 可能不触发
// onclose/onerror 而帧已停——sendOpen 后 OPEN_ACK_TIMEOUT_MS 内零下行帧
// 即弃旧 socket 立即重建，注册流全部重开。假定时器驱动时间线。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mux } from "../mux";

/** 每次构造记录实例并可选驱动 onopen 的假 WebSocket；僵尸模式 close 后不回调 onclose。 */
let sockets: FakeSocket[];
let driveOpen: boolean;
class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  readyState = FakeSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  /** 僵尸标记：close() 被调后假装断连事件永远不会来（WKWebView 假死语义）。 */
  zombified = false;
  send(d: unknown) { this.sent.push(String(d)); }
  close() { this.zombified = true; } // 不触发 onclose —— 看门狗存在的意义
  constructor() { sockets.push(this); if (driveOpen) queueMicrotask(() => { this.readyState = FakeSocket.OPEN; this.onopen?.(); }); }
}

const opensOf = (s: FakeSocket) => (s.sent.map((d) => JSON.parse(d) as { type: string; endpoint?: string; streamId?: string })
  .filter((f) => f.type === "open"));

beforeEach(() => {
  // mux 是模块级单例：清空内部态（流注册/定时器/socket），测试各自从零开始。
  const m = mux as unknown as {
    ws: FakeSocket | null; streams: Map<string, unknown>; eventsHandlers: Set<unknown>;
    eventClientId: string | undefined; openAckTimer: number | null; retryTimer: number | null;
    reopenTimers: Map<string, number>; reopenBackoff: Map<string, number>;
  };
  if (m.openAckTimer !== null) clearTimeout(m.openAckTimer);
  if (m.retryTimer !== null) clearTimeout(m.retryTimer);
  m.openAckTimer = null; m.retryTimer = null; m.ws = null;
  for (const t of m.reopenTimers.values()) clearTimeout(t);
  m.reopenTimers.clear(); m.reopenBackoff.clear();
  m.streams.clear(); m.eventsHandlers.clear(); m.eventClientId = undefined;
  sockets = []; driveOpen = true;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("mux 开流应答看门狗", () => {
  it("假死（开流后零下行帧）→ 弃旧 socket 立即重建，注册流全部重开", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);

    const items: unknown[] = [];
    mux.openStream("session/follow", { request: { address: { kind: "session", sessionId: "s1" } } }, (v) => items.push(v));
    await Promise.resolve(); // 构造器 queueMicrotask 驱动 onopen（开流帧在 open 后才发出）
    expect(sockets).toHaveLength(1);
    const zombie = sockets[0];
    // 健康路径收帧解除看门狗后，把 socket 变僵尸：此后帧永不到达。
    zombie.onmessage?.({ data: JSON.stringify({ type: "item", streamId: opensOf(zombie)[0]!.streamId!, value: "snap" }) });
    expect(items).toEqual(["snap"]);

    // 再开一条流 → 布防；推进超时窗口，零下行帧 → 回收重建。
    mux.openStream("session/control", { request: {} }, () => {});
    vi.advanceTimersByTime(5001);
    await Promise.resolve(); // 等 socket2 的 onopen 微任务跑完（重开帧在此发出）
    expect(sockets).toHaveLength(2);
    expect(zombie.zombified).toBe(true);
    expect(zombie.onclose).toBeNull(); // 处理器已摘，迟到的假死事件不得再驱动状态

    // 重建后 onopen 全量重开：两条流的开流帧都在新 socket 上。
    const endpoints = opensOf(sockets[1]).map((f) => f.endpoint);
    expect(endpoints).toContain("session/follow");
    expect(endpoints).toContain("session/control");
  });

  it("卡在 CONNECTING 的假死同样被回收（sendOpen 被静默丢弃的路径）", () => {
    vi.useFakeTimers();
    driveOpen = false; // 永不 open：CONNECTING 假死
    vi.stubGlobal("WebSocket", FakeSocket);

    mux.openStream("workspace/follow", { request: {} }, () => {});
    const stuck = sockets[0];
    expect(stuck.sent).toHaveLength(0); // 未 OPEN，帧没发出

    vi.advanceTimersByTime(5001);
    expect(sockets).toHaveLength(2); // 弃掉重建
    expect(stuck.zombified).toBe(true);
  });

  it("健康连接的静默空闲不触发回收（无开流动作即无布防）", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);

    mux.openStream("workspace/follow", { request: {} }, () => {});
    await Promise.resolve(); // 等 onopen 发出开流帧
    const sock = sockets[0];
    // 首帧到达：解除开流应答看门狗，连接进入「健康但静默」形态（本用例的前提）。
    sock.onmessage?.({ data: JSON.stringify({ type: "item", streamId: opensOf(sock)[0]!.streamId!, value: {} }) });
    expect(mux.stalled).toBe(false);

    vi.advanceTimersByTime(30000); // 静默远超窗口：期望看门狗（store）据此判哑火
    expect(mux.stalled).toBe(true);
    sock.onmessage?.({ data: JSON.stringify({ type: "item", streamId: opensOf(sock)[0]!.streamId!, value: {} }) });
    expect(mux.stalled).toBe(false); // 下行帧到达即复位

    // 长时间空闲推进（远超窗口）：无新开流 → 无布防 → 不重建。
    vi.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(1);
  });

  it("重连后静默计时复位：哑火连接不被每个轮询 tick 连环重建", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);

    mux.openStream("session/follow", { request: {} }, () => {});
    await Promise.resolve(); // 等 onopen 发出开流帧
    const sock = sockets[0];
    sock.onmessage?.({ data: JSON.stringify({ type: "item", streamId: opensOf(sock)[0]!.streamId!, value: "snap" }) });
    vi.advanceTimersByTime(60000); // 连接哑火：静默累积
    expect(mux.stalled).toBe(true);
    expect(sockets).toHaveLength(1); // 无开流动作，开流应答看门狗不参与

    mux.recycle(); // store 看门狗的一次重建
    expect(sockets).toHaveLength(2);
    expect(mux.stalled).toBe(false); // 静默从重建时刻起算（不复用旧时间戳）
    vi.advanceTimersByTime(8001);
    expect(mux.stalled).toBe(true); // 新连接再来一个窗口无帧才再判哑火
  });

  it("快照后假死由 recycle() 兜底（壳层系统唤醒钩子入口）：弃旧重建、注册流全部重开", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);

    // 两条流都开好并收到首帧——看门狗解除，连接处于「静默空闲」形态。
    const items: unknown[] = [];
    mux.openStream("session/follow", { request: { address: { kind: "session", sessionId: "s1" } } }, (v) => items.push(v));
    mux.openStream("session/control", { request: {} }, () => {});
    await Promise.resolve();
    const sock = sockets[0];
    const followId = opensOf(sock).find((f) => f.endpoint === "session/follow")!.streamId!;
    const controlId = opensOf(sock).find((f) => f.endpoint === "session/control")!.streamId!;
    sock.onmessage?.({ data: JSON.stringify({ type: "item", streamId: followId, value: "snap" }) });
    sock.onmessage?.({ data: JSON.stringify({ type: "item", streamId: controlId, value: {} }) });
    vi.advanceTimersByTime(60000); // 空闲极久也不重建（上一例语义）
    expect(sockets).toHaveLength(1);

    // 系统唤醒：壳层推 systemWake → recycle()——假死的 socket 无任何 JS 侧
    // 迹象，靠这个显式入口恢复。
    mux.recycle();
    expect(sockets).toHaveLength(2);
    expect(sock.zombified).toBe(true);
    await Promise.resolve(); // 等 socket2 的 onopen 微任务（重开帧在此发出）
    const reopened = opensOf(sockets[1]).map((f) => f.endpoint);
    expect(reopened).toContain("session/follow");
    expect(reopened).toContain("session/control");
  });

  it("流 error 后按退避重开同 streamId（引擎跳号终止流的自愈）", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);

    const close = mux.openStream("session/follow", { request: {} }, () => {});
    await Promise.resolve(); // 等 onopen 发出首开流帧
    const sock = sockets[0];
    const sid = opensOf(sock)[0]!.streamId!;
    sock.onmessage?.({ data: JSON.stringify({ type: "item", streamId: sid, value: "snap" }) });

    // 引擎侧终止（如 follow 生成器跳号抛错）：1s 后同 id 重开。
    sock.onmessage?.({ data: JSON.stringify({ type: "error", streamId: sid }) });
    vi.advanceTimersByTime(999);
    expect(opensOf(sock).filter((f) => f.streamId === sid)).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(opensOf(sock).filter((f) => f.streamId === sid)).toHaveLength(2);
    close();
  });

  it("连续 error 退避倍增；重新出帧后复位", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);

    mux.openStream("session/follow", { request: {} }, () => {});
    await Promise.resolve();
    const sock = sockets[0];
    const sid = opensOf(sock)[0]!.streamId!;
    const opensOfId = () => opensOf(sock).filter((f) => f.streamId === sid);

    sock.onmessage?.({ data: JSON.stringify({ type: "error", streamId: sid }) });
    vi.advanceTimersByTime(1000); // 第 1 次重开（1s）
    expect(opensOfId()).toHaveLength(2);

    sock.onmessage?.({ data: JSON.stringify({ type: "error", streamId: sid }) });
    vi.advanceTimersByTime(1000); // 退避翻倍：2s 未到，不重开
    expect(opensOfId()).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(opensOfId()).toHaveLength(3);

    // 恢复出帧（快照重新到达）后再次失败：退避已复位为 1s。
    sock.onmessage?.({ data: JSON.stringify({ type: "item", streamId: sid, value: "snap" }) });
    sock.onmessage?.({ data: JSON.stringify({ type: "error", streamId: sid }) });
    vi.advanceTimersByTime(1000);
    expect(opensOfId()).toHaveLength(4);
  });

  it("close() 撤销未决重开：不再发开流帧", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeSocket);

    const close = mux.openStream("session/follow", { request: {} }, () => {});
    await Promise.resolve();
    const sock = sockets[0];
    const sid = opensOf(sock)[0]!.streamId!;
    sock.onmessage?.({ data: JSON.stringify({ type: "item", streamId: sid, value: "snap" }) });
    sock.onmessage?.({ data: JSON.stringify({ type: "end", streamId: sid }) });

    close(); // 消费方卸载（如切走会话）：重开作废
    vi.advanceTimersByTime(60000);
    expect(opensOf(sock).filter((f) => f.streamId === sid)).toHaveLength(1);
  });
});
