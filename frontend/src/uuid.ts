// uuid：全站唯一 id 生成入口（rpcId / requestId / streamId / 列表键）。
//
// 为什么不用 crypto.randomUUID：它只在**安全上下文**（HTTPS 或 localhost）
// 存在。手机经局域网 http://<ip>:<port> 打开时它是 undefined——React 挂载
// 即抛 TypeError、整页白屏（实测：`[web] Uncaught TypeError: crypto.randomUUID
// is not a function`）。getRandomValues 在非安全上下文同样可用，随机性不减，
// 只是版本位与格式自己拼。

export function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
