// remote.mux 多路流客户端（0.1.2 wire，vendored packages/api/gateway/src/
// stream-protocol.ts）：单条 WebSocket 承载全部逻辑流——上行 `{type:'open',
// streamId, endpoint, payload:{args}}` / `{type:'cancel', streamId}`，下行
// `{type:'item', streamId, value?}` / `{type:'error'|'end', streamId}`。
// 本模块持有进程级单例：$events 转发事件流 + 任意业务流（session/follow、
// session/control、workspace/follow）共用一条连接；断线 2s 重连，重连后所有
// 注册流自动重开（服务端每代重发基线/快照，消费方按全量替换处理）；
// 另有开流应答看门狗兜住 WKWebView 睡眠后 onclose 缺位的假死连接。
// 不管业务语义（帧解释归 api.ts 的类型与 store/useSessionEvents 的消费）。

export interface RemoteEventReadyFrame {
  type: "ready";
  clientId: string;
  host: { home: string };
}

export interface RemoteEventWaterfallFrame {
  type: "waterfall";
  event: string;
  eventId: string;
  agentId: string;
  request: Record<string, unknown>;
}

export type WaterfallOutcome =
  | { kind: "next" }
  | { kind: "result"; value?: unknown }
  | { kind: "rejected"; error: { name: string; message: string; code?: string } };

interface StreamEntry {
  endpoint: string;
  args: Record<string, unknown>;
  onItem: (value: unknown) => void;
}

type EventsHandlers = {
  onEmit?: (event: string, args: unknown[]) => void;
  onWaterfall?: (frame: RemoteEventWaterfallFrame) => void;
  onCancel?: (eventId: string) => void;
};

const MUX_PATH = "/api/remote.mux";
const EVENTS_ENDPOINT = "$events";

// 开流应答看门狗超时：任何开流帧发出（或待发）后，整条连接在此窗口内
// 连一个下行帧（ready/快照/基线都算）都没收到，即判定 socket 假死。
const OPEN_ACK_TIMEOUT_MS = 5000;

class MuxClient {
  private ws: WebSocket | null = null;
  private retryTimer: number | null = null;
  private streams = new Map<string, StreamEntry>();
  private eventsHandlers = new Set<EventsHandlers>();
  /** $events 世代 clientId：应答 waterfall 的必填字段。 */
  private eventClientId: string | undefined;
  /** 开流应答看门狗：见 armOpenAck。 */
  private openAckTimer: number | null = null;

  /** 注册一条逻辑流：连接建立（或重建）时自动 open；close() 撤销注册。
   *  onItem 收到该流的每个 item value（含首帧快照/基线）。 */
  openStream(endpoint: string, args: Record<string, unknown>, onItem: (value: unknown) => void): () => void {
    const streamId = `${endpoint}-${crypto.randomUUID()}`;
    this.streams.set(streamId, { endpoint, args, onItem });
    this.ensureConnected();
    this.sendOpen(streamId);
    return () => {
      this.streams.delete(streamId);
      this.send({ type: "cancel", streamId });
    };
  }

  /** 订阅 $events 转发事件（emit 通知 / waterfall 交互请求 / cancel 撤销）。
   *  首个订阅者挂载时开流；流本身进程级常驻。 */
  onEvents(handlers: EventsHandlers): () => void {
    this.eventsHandlers.add(handlers);
    this.ensureConnected();
    this.openEventsStream();
    return () => {
      this.eventsHandlers.delete(handlers);
    };
  }

  /** 应答一条 waterfall（HTTP $events/result，非 WS 帧——引擎侧约定）。
   *  clientId 用当前 $events 世代；结果返回 void，失败由调用方决定重试。 */
  async answerEvent(eventId: string, outcome: WaterfallOutcome): Promise<void> {
    if (this.eventClientId === undefined) throw new Error("events: no active generation");
    const res = await fetch(`/api/${"$events/result"}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "client-request",
        rpcId: crypto.randomUUID(),
        method: "$events/result",
        payload: { args: { clientId: this.eventClientId, eventId, outcome } },
      }),
    });
    if (!res.ok) throw new Error(`events/result HTTP ${res.status}`);
    const full = await res.json() as { result?: { ok?: boolean; error?: { code?: string; message?: string } } };
    if (full.result && full.result.ok !== true) {
      throw new Error(`${full.result.error?.code ?? "rpc"}: ${full.result.error?.message ?? "unknown"}`);
    }
  }

  // ── 内部：连接与帧派发 ──

  private ensureConnected() {
    if (this.ws === null || this.ws.readyState === WebSocket.CLOSED) {
      this.connect();
    }
  }

  private connect() {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    // 测试环境（node）无 location：host 用占位值，WS 为注入桩。
    const host = typeof location !== "undefined" ? location.host : "test.invalid";
    this.ws = new WebSocket(`ws://${host}${MUX_PATH}`);
    this.ws.onopen = () => {
      // 重连后所有注册流重开（服务端重发基线/快照，消费方全量替换）。
      // $$events 已在 streams 表内、循环覆盖——勿再单独发：同一 streamId
      // 双开会被网关按协议违规整条断连（close 1008），重连即死循环。
      for (const [streamId] of this.streams) this.sendOpen(streamId);
    };
    this.ws.onmessage = (e) => {
      try {
        this.dispatch(JSON.parse(String(e.data)) as Record<string, unknown>);
      } catch {
        // 一条坏帧不能杀掉整条流
      }
    };
    this.ws.onclose = () => {
      this.eventClientId = undefined;
      this.disarmOpenAck();
      this.retryTimer = setTimeout(() => this.connect(), 2000) as unknown as number;
    };
    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private send(frame: Record<string, unknown>) {
    if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  private sendOpen(streamId: string) {
    const entry = this.streams.get(streamId);
    if (!entry) return;
    // 看门狗在「想开流」时布防而非只在帧发出后：socket 卡在 CONNECTING、
    // send 被静默丢弃同样没有应答，一并覆盖。
    this.armOpenAck();
    this.send({ type: "open", streamId, endpoint: entry.endpoint, payload: { args: entry.args } });
  }

  // ── 假死自愈（WKWebView 系统睡眠后 WS 可能既不 onclose 也不 onerror，
  //    JS 侧毫无断连迹象而帧已停——重连只挂在 onclose 上就永不触发。
  //    每条流开流后必收首帧（$events ready / follow 快照 / control·workspace
  //    基线），故「开流后 OPEN_ACK_TIMEOUT_MS 内整条连接零下行帧」唯一解释
  //    是假死；静默空闲的健康连接不会开流，永不误伤。 ──

  private armOpenAck() {
    if (this.openAckTimer !== null) return;
    this.openAckTimer = setTimeout(() => {
      this.openAckTimer = null;
      this.recycleSocket();
    }, OPEN_ACK_TIMEOUT_MS) as unknown as number;
  }

  private disarmOpenAck() {
    if (this.openAckTimer === null) return;
    clearTimeout(this.openAckTimer);
    this.openAckTimer = null;
  }

  /** 弃掉当前 socket 并立即重建：不等待（可能永不来的）close 事件。 */
  private recycleSocket() {
    this.disarmOpenAck();
    const old = this.ws;
    this.ws = null;
    this.eventClientId = undefined;
    if (old !== null) {
      // 先摘处理器再 close：假死 socket 的 close 可能延迟到再下一轮，迟到的
      // onclose/onopen 打到已退役的实例上会双驱重连。
      old.onopen = null;
      old.onmessage = null;
      old.onclose = null;
      old.onerror = null;
      old.close();
    }
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.connect();
  }

  private openEventsStream() {
    // $events 以固定 streamId 常驻注册：仅在首次注册时发开流帧（重连后的
    // 重开由 onopen 的全量循环负责，重复即双开）。
    if (this.streams.has("$$events")) return;
    this.streams.set("$$events", {
      endpoint: EVENTS_ENDPOINT,
      args: {},
      onItem: (value) => this.consumeEventValue(value),
    });
    this.sendOpen("$$events");
  }

  private dispatch(frame: Record<string, unknown>) {
    const streamId = frame.streamId;
    if (typeof streamId !== "string") return;
    // 任何下行帧都证明连接活着——看门狗就此解除（下次开流重新布防）。
    this.disarmOpenAck();
    if (frame.type === "item") {
      this.streams.get(streamId)?.onItem(frame.value);
    } else if (frame.type === "end" || frame.type === "error") {
      // 流正常/异常终止：注销注册（control/workspace 等长驻流依赖重连重开）。
      if (streamId !== "$$events") this.streams.delete(streamId);
    }
  }

  private consumeEventValue(value: unknown) {
    if (typeof value !== "object" || value === null) return;
    const frame = value as Record<string, unknown>;
    if (frame.type === "ready") {
      if (typeof frame.clientId === "string") this.eventClientId = frame.clientId;
    } else if (frame.type === "emit") {
      if (typeof frame.event === "string" && Array.isArray(frame.args)) {
        for (const h of this.eventsHandlers) h.onEmit?.(frame.event, frame.args);
      }
    } else if (frame.type === "waterfall") {
      if (typeof frame.event === "string" && typeof frame.eventId === "string"
        && typeof frame.agentId === "string" && typeof frame.request === "object" && frame.request !== null) {
        for (const h of this.eventsHandlers) {
          h.onWaterfall?.(frame as unknown as RemoteEventWaterfallFrame);
        }
      }
    } else if (frame.type === "cancel") {
      if (typeof frame.eventId === "string") {
        for (const h of this.eventsHandlers) h.onCancel?.(frame.eventId as string);
      }
    }
  }
}

/** 进程级单例：整条 SPA 只开一条 remote.mux 连接。 */
export const mux = new MuxClient();
