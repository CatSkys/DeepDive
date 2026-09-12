// 自动归档候选判定（纯函数）：已完成 + 无未读 + **未置顶** + 超过保留期，
// 且不裁当前打开的会话；边界（恰好等于保留期）不裁。
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION, RETENTIONS, archiveCandidates, retentionLabel, retentionMs } from "../autoArchive";

const HOUR = 3_600_000;
const now = 1_000 * HOUR;
const sessions = [
  { sessionId: "old", updatedAt: now - 8 * 24 * HOUR },            // 超期
  { sessionId: "pinned", updatedAt: now - 30 * 24 * HOUR },        // 超期但置顶
  { sessionId: "unread", updatedAt: now - 30 * 24 * HOUR },        // 超期但有未读
  { sessionId: "running", updatedAt: now - 30 * 24 * HOUR, running: true },
  { sessionId: "active", updatedAt: now - 30 * 24 * HOUR },        // 当前打开
  { sessionId: "fresh", updatedAt: now - HOUR },                   // 未超期
];

describe("archiveCandidates", () => {
  it("只裁超期且未置顶/无未读/不在运行/非当前会话的条目", () => {
    const ids = archiveCandidates(sessions, {
      pinned: new Set(["pinned"]),
      unread: new Set(["unread"]),
      activeSessionId: "active",
      retentionMs: retentionMs("7d"),
      now,
    });
    expect(ids).toEqual(["old"]);
  });

  it("边界：恰好等于保留期不裁（严格早于才裁）", () => {
    const exactly = [{ sessionId: "edge", updatedAt: now - retentionMs("12h") }];
    expect(archiveCandidates(exactly, {
      pinned: new Set(), unread: new Set(), activeSessionId: null, retentionMs: retentionMs("12h"), now,
    })).toEqual([]);
    expect(archiveCandidates([{ sessionId: "edge", updatedAt: now - retentionMs("12h") - 1 }], {
      pinned: new Set(), unread: new Set(), activeSessionId: null, retentionMs: retentionMs("12h"), now,
    })).toEqual(["edge"]);
  });

  it("时长档：12h < 24h < 7d < 30d，默认 7 天且都有显示名", () => {
    const ms = RETENTIONS.map((r) => r.ms);
    expect(ms).toEqual([...ms].sort((a, b) => a - b));
    expect(DEFAULT_RETENTION).toBe("7d");
    for (const r of RETENTIONS) expect(retentionLabel(r.id)).toContain("归档");
  });
});
