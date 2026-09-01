/** Minimal dynamic-JSON diff shared by the built-in settings sections
 *  (same semantics as the shell-side JSONValue.diffOps). */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function diffOps(from: Json, to: Json, path: string[] = []): Array<{ op: string; path: string; value?: unknown }> {
  const ops: Array<{ op: string; path: string; value?: unknown }> = [];
  const isObj = (v: Json): v is { [k: string]: Json } => v !== null && typeof v === "object" && !Array.isArray(v);
  if (isObj(from) && isObj(to)) {
    for (const [k, v] of Object.entries(to)) {
      if (JSON.stringify(from[k]) !== JSON.stringify(v)) {
        ops.push(...diffOps(from[k] ?? null, v, [...path, k]));
      }
    }
    for (const k of Object.keys(from)) {
      if (!(k in to)) ops.push({ op: "unset", path: [...path, k].join(".") });
    }
    return ops;
  }
  if (JSON.stringify(from) !== JSON.stringify(to)) {
    ops.push(to === null
      ? { op: "unset", path: path.join(".") }
      : { op: "set", path: path.join("."), value: to });
  }
  return ops;
}

export function setPath(base: Json, segments: string[], value: Json): Json {
  if (segments.length === 0) return value;
  const [head, ...rest] = segments;
  const obj: { [k: string]: Json } = base !== null && typeof base === "object" && !Array.isArray(base)
    ? { ...(base as { [k: string]: Json }) }
    : {};
  obj[head] = setPath(obj[head] ?? null, rest, value);
  return obj;
}
