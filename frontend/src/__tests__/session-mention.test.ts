// 会话引用纯函数（session/sessionMention.ts）：规范 mention 与引擎
// formatSessionReferenceMention 同构——base64url 无 padding、label 转义、
// 候选排除当前会话/标题过滤/近期优先。
import { describe, expect, it } from "vitest";
import {
  encodeSessionReferenceUri, formatSessionReferenceMention, sessionMentionCandidates,
} from "../session/sessionMention";
import type { SessionSummary } from "../types";

const s = (id: string, updatedAt: number, title?: string): SessionSummary => ({
  sessionId: id,
  updatedAt,
  running: false,
  blank: false,
  ...(title ? { projections: { asOfSeq: 0, values: { title } } } : {}),
});

describe("encodeSessionReferenceUri", () => {
  it("base64url 无 padding，与引擎 Buffer(utf8)+base64url 同构", () => {
    expect(encodeSessionReferenceUri("s-archive")).toBe("dsh-session:InMtYXJjaGl2ZSI");
  });
  it("可无损往返（decode = base64url → JSON.parse）", () => {
    const uri = encodeSessionReferenceUri("sess_abc-123_XY");
    const payload = uri.slice("dsh-session:".length);
    const b64 = payload.replaceAll("-", "+").replaceAll("_", "/");
    const json = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    expect(JSON.parse(json)).toBe("sess_abc-123_XY");
  });
});

describe("formatSessionReferenceMention", () => {
  it("输出 @[label](uri) 规范 mention", () => {
    expect(formatSessionReferenceMention("s1", "Reviewing Plan")).toMatch(
      /^@\[Reviewing Plan\]\(dsh-session:[A-Za-z0-9_-]+\)$/,
    );
  });
  it("label 的 \\ 与 ] 转义（引擎 escapeLabel 同款）", () => {
    const mention = formatSessionReferenceMention("s1", "a]b\\c");
    expect(mention.startsWith("@[a\\]b\\\\c](dsh-session:")).toBe(true);
  });
});

describe("sessionMentionCandidates", () => {
  const sessions = [
    s("current", 100, "当前会话"),
    s("b-old", 10, "Beta 架构讨论"),
    s("a-new", 50, "alpha 计划"),
    s("c-blank", 70),
  ];

  it("排除当前会话，近期优先，带规范 mention", () => {
    const rows = sessionMentionCandidates(sessions, "current", "", "zh");
    expect(rows.map((r) => r.sessionId)).toEqual(["c-blank", "a-new", "b-old"]);
    expect(rows[1].label).toBe("alpha 计划");
    expect(rows[1].mention).toMatch(/^@\[alpha 计划\]\(dsh-session:/);
  });

  it("query 大小写不敏感匹配标题；无命中为空", () => {
    expect(sessionMentionCandidates(sessions, "current", "ALPHA", "zh").map((r) => r.sessionId)).toEqual(["a-new"]);
    expect(sessionMentionCandidates(sessions, "current", "没有", "zh")).toEqual([]);
  });

  it("截取上限 10 条", () => {
    const many = Array.from({ length: 25 }, (_, i) => s(`s${i}`, i));
    expect(sessionMentionCandidates(many, null, "", "zh").length).toBe(10);
  });
});
