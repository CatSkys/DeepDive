/** 流式取证钩子（临时诊断态，`__ddStream.dump()` 读取，诊断结束后移除）：
 *  mux 的每次下行帧 / recycle / 流级重开 / 断连，与直播事件帧出口各记一笔。
 *  Safari 检查器 console 里跑 `window.__ddStream.dump()`（或 `clear()` 清零）
 *  复制全量行贴回即可定位卡在哪一层：帧的到达节奏（Δgap）、recycle/reopen
 *  的发生点、每类事件的序。不进任何渲染/状态。 */
type DiagRow = { t: number; kind: string; detail?: string; gap: number };

const ROWS: DiagRow[] = [];
let lastAt = 0;

const push = (kind: string, detail?: string): void => {
  const now = Date.now();
  const gap = lastAt === 0 ? 0 : now - lastAt;
  lastAt = now;
  if (ROWS.length >= 600) ROWS.shift();
  ROWS.push({ t: now, kind, detail, gap });
};

const dump = (): string => {
  const base = ROWS[0]?.t ?? 0;
  return ROWS.map((r) => `+${String(r.t - base).padStart(6)}ms ${r.kind}${r.detail ? " " + r.detail : ""}${r.gap > 40 ? " (Δ" + r.gap + "ms)" : ""}`).join("\n");
};

const clear = (): void => {
  ROWS.length = 0;
  lastAt = 0;
};

type Buckets = {
  push: (kind: string, detail?: string) => void;
  dump: () => string;
  clear: () => void;
};

(globalThis as unknown as Record<string, unknown>).__ddStream = { push, dump, clear } satisfies Buckets;

import { sendToShell } from "../host";

/** 走壳 host 桥把诊断行落进引擎日志（engine.log），agent 无需 inspector 即可读。
 *  降噪：item 帧（每帧高频）只有当 Δgap>40ms（疑似卡顿）才落账；事件类帧
 *  （ws/recycle/reopen/turn、snapshot 等）全量落账。非浏览器环境（vitest node）
 *  无 window：不送（ROWS 本地记账照常，dump 仍可用）。 */
const pushLog = (kind: string, detail?: string): void => {
  push(kind, detail);
  const isItem = kind === "item";
  const row = ROWS[ROWS.length - 1]!;
  if (isItem && !(row.gap > 40)) return;
  if (typeof window === "undefined") return; // vitest/node：无壳桥可送
  sendToShell({ type: "log-diag", msg: `${kind}${detail ? " " + detail : ""}` });
};

export { pushLog as streamDiag };
export { push as rawDiag };

