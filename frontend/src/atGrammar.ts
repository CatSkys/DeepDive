// @ 引用 grammar：官方 dsh-file-reference/grammar 的浏览器安全移植
// （docs/DSH-WIRE.md §5）。只管 token 提取与格式化；不管候选发现。
// 纯函数，vitest 钉住官方语义（引号、目录尾斜杠、空白触发）。

export interface ActiveAtToken {
  /** 完整 token（含 @ 与引号），接受补全时被整体替换。 */
  prefix: string;
  /** @ 或 @" 之后的路径查询。 */
  query: string;
  /** 用户是否用 @" 开了引号路径。 */
  quoted: boolean;
}

/** 光标处活跃的 @token。邮箱内等场景（@ 前无空白/行首）不触发。 */
export function activeAtToken(line: string, cursorCol: number): ActiveAtToken | undefined {
  const beforeCursor = line.slice(0, cursorCol);
  const quoted = /(?:^|\s)(@"([^"]*))$/u.exec(beforeCursor);
  if (quoted?.[1] !== undefined && quoted[2] !== undefined) {
    return { prefix: quoted[1], query: quoted[2], quoted: true };
  }
  const plain = /(?:^|\s)(@([^\s]*))$/u.exec(beforeCursor);
  if (plain?.[1] === undefined || plain[2] === undefined) return undefined;
  return { prefix: plain[1], query: plain[2], quoted: false };
}

export interface MentionCandidate {
  path: string;
  kind: "file" | "directory";
}

/** 选中路径 → 提及文本。目录补尾 /；含空格路径加引号；带引号目录保持
 *  引号开启以便续层补全。路径含控制字符/引号时无法安全表达 → undefined。 */
export function formatMention(candidate: MentionCandidate, preserveQuote: boolean): string | undefined {
  const path = candidate.kind === "directory" ? `${candidate.path}/` : candidate.path;
  // eslint-disable-next-line no-control-regex -- 官方 grammar 同款：控制字符/引号路径显式拒绝
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return undefined;
  const quoted = preserveQuote || /\s/u.test(path);
  if (!quoted) return `@${path}`;
  return candidate.kind === "directory" ? `@"${path}` : `@"${path}"`;
}
