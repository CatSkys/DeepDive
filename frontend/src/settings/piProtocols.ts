// 手写提供方（llm-pi-ai）可声明的 wire 协议清单。取该命名空间自己的 schema，
// 不在前端另存一份协议表——协议表属于引擎（llm-pi-ai/provider.ts 的 PROTOCOLS），
// schema 是它在 settings 面上的同一份投影。
//
// 载荷是 schemastery 的 compact refs 编码（settings/describe 实测形状，与
// permissionPreset.ts 读 permission 枚举同一套走法）：
//   refs[uid] → object.dict.providers → dict.inner → object.dict.api → union.list → const.value
// 形状不合（引擎没挂 llm-pi-ai / 升级换了编码）返回空表：调用方据此不提供自定义入口。

interface SchemaNode {
  type?: string;
  inner?: unknown;
  list?: unknown[];
  dict?: Record<string, unknown>;
  value?: unknown;
}

interface SchemaEnvelope {
  uid?: unknown;
  refs?: Record<string, SchemaNode>;
}

export function piProtocolsOf(entry: { schema?: unknown } | undefined): string[] {
  const schema = entry?.schema as SchemaEnvelope | undefined;
  const refs = schema?.refs;
  if (!refs) return [];
  // refs 的取值是 id（数字或字符串），不是内联节点。
  const node = (id: unknown): SchemaNode | undefined =>
    typeof id === "number" || typeof id === "string" ? refs[String(id)] : undefined;
  const root = node(schema?.uid);
  const profile = node(node(root?.dict?.providers)?.inner);
  const union = node(profile?.dict?.api);
  if (union?.type !== "union" || !Array.isArray(union.list)) return [];
  return union.list.flatMap((id) => {
    const choice = node(id);
    return choice?.type === "const" && typeof choice.value === "string" ? [choice.value] : [];
  });
}
