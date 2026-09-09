// chunk 行解码（0.1.2 wire）：引擎把连续同块的 assistant/chunk 增量压成
// text-chunks / reasoning-chunks / tool-call-chunks 一条记录（无损打包，见
// vendored packages/core/session/src/chunk-rows.ts）。这里移植其解码半边，
// 把 wire 记录还原成原始事件序列——事件词表不变，摄取层无感。
// 只解码不编码：客户端永远消费方。恶意/畸形行按引擎同款语义抛错，调用方
// （冷读装载）把整页装载记为失败，绝不静默丢行。

import type { SessionEvent, StreamChunk } from "./types";

/** 打包行（wire 形状；data 载荷按 type 分流）。 */
export type ChunkRow =
  | { type: "text-chunks"; seq0: number; time0: number; data: TextRunData }
  | { type: "reasoning-chunks"; seq0: number; time0: number; data: TextRunData }
  | { type: "tool-call-chunks"; seq0: number; time0: number; data: ToolCallRunData };

interface RunDataBase {
  turn: number;
  step: number;
  index: number;
  dt: number[];
}

interface TextRunData extends RunDataBase {
  texts: string[];
}

interface ToolCallRunData extends RunDataBase {
  id: string;
  name?: string;
  args: string[];
}

function malformed(tag: string, why: string): never {
  throw new Error(`chunkrow/${tag}: ${why}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k));
}

/** 校验一段字符串载荷（texts/args 共用）：dt 与成员数严格配对。 */
function validateRunData(tag: string, data: Record<string, unknown>, key: "texts" | "args"): string[] {
  const payload = data[key];
  if (!Array.isArray(payload) || payload.some((m) => typeof m !== "string")) {
    malformed(tag, `${key} must be an array of strings`);
  }
  const dt = data.dt;
  if (!Array.isArray(dt) || dt.some((gap) => !Number.isSafeInteger(gap))) {
    malformed(tag, "dt must be an array of safe integers");
  }
  if (dt.length !== payload.length - 1) {
    malformed(tag, `dt length ${String(dt.length)} does not match ${String(payload.length)} members`);
  }
  return payload as string[];
}

/** 结构校验（对齐引擎 validateRow），通过后返回强类型行。 */
function validateRow(value: unknown, tag: ChunkRow["type"]): ChunkRow {
  if (!isRecord(value) || !hasExactKeys(value, ["type", "seq0", "time0", "data"])) {
    malformed(tag, "envelope must be exactly {type, seq0, time0, data}");
  }
  if (!Number.isSafeInteger(value.seq0) || (value.seq0 as number) < 0 || Object.is(value.seq0, -0)) {
    malformed(tag, "seq0 must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(value.time0)) {
    malformed(tag, "time0 must be a safe integer");
  }
  const data = value.data;
  if (!isRecord(data)) malformed(tag, "data must be an object");
  if (tag === "tool-call-chunks") {
    const withName = hasExactKeys(data, ["turn", "step", "index", "id", "name", "dt", "args"]);
    if (!withName && !hasExactKeys(data, ["turn", "step", "index", "id", "dt", "args"])) {
      malformed(tag, "data must be exactly {turn, step, index, id, name?, dt, args}");
    }
    if (typeof data.id !== "string" || (withName && typeof data.name !== "string")) {
      malformed(tag, "id (and name when present) must be strings");
    }
    validateRunData(tag, data, "args");
  } else {
    if (!hasExactKeys(data, ["turn", "step", "index", "dt", "texts"])) {
      malformed(tag, "data must be exactly {turn, step, index, dt, texts}");
    }
    validateRunData(tag, data, "texts");
  }
  return value as unknown as ChunkRow;
}

/** chunkrow/* 判别（打包行是编码词汇，不是事件类型）。 */
export function isChunkRow(record: unknown): record is { type: ChunkRow["type"]; [k: string]: unknown } {
  return isRecord(record)
    && (record.type === "text-chunks" || record.type === "reasoning-chunks" || record.type === "tool-call-chunks");
}

/** 把一条打包行还原为原始 assistant/chunk 事件序列（引擎 expandRow 同款）。 */
export function expandChunkRow(record: unknown): SessionEvent[] {
  const row = validateRow(record, (record as { type: ChunkRow["type"] }).type);
  const members = row.type === "tool-call-chunks" ? row.data.args : row.data.texts;
  const events: SessionEvent[] = [];
  let time = row.time0;
  for (let k = 0; k < members.length; k++) {
    if (k > 0) time += row.data.dt[k - 1]!;
    let chunk: StreamChunk;
    if (row.type === "text-chunks") {
      chunk = { type: "text-delta", index: row.data.index, text: members[k] };
    } else if (row.type === "reasoning-chunks") {
      chunk = { type: "reasoning-delta", index: row.data.index, text: members[k] };
    } else {
      chunk = { type: "tool-call-delta", index: row.data.index, id: row.data.id, ...(row.data.name === undefined ? {} : { name: row.data.name }), argumentsDelta: members[k] };
    }
    events.push({
      type: "assistant/chunk",
      seq: row.seq0 + k,
      time,
      data: { turn: row.data.turn, step: row.data.step, chunk },
    });
  }
  return events;
}
