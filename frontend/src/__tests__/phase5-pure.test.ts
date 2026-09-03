// 阶段 5 纯函数钉子：schedule/change 折叠（会话提醒目录）。
import { describe, expect, it } from "vitest";
import { foldSchedule } from "../components/SessionView";
import type { ScheduleChangeData } from "../types";

const at = (id: string, scheduledAt = "2026-09-04T09:00:00Z") => ({ id, kind: "at" as const, prompt: `提醒 ${id}`, scheduledAt });

describe("foldSchedule", () => {
  it("create 登记新记录；同 id 重复 create 幂等", () => {
    const recs = foldSchedule([], { version: 1, operation: "create", schedule: at("s1") });
    expect(recs.map((r) => r.id)).toEqual(["s1"]);
    const again = foldSchedule(recs, { version: 1, operation: "create", schedule: at("s1", "2026-09-05T09:00:00Z") });
    expect(again.map((r) => r.scheduledAt)).toEqual(["2026-09-04T09:00:00Z"]);
  });

  it("delete 移除；dispatch/advance 不改变目录（投递史不入目录）", () => {
    let recs = foldSchedule([], { version: 1, operation: "create", schedule: at("s1") });
    recs = foldSchedule(recs, { version: 1, operation: "dispatch", id: "s1" } as ScheduleChangeData);
    expect(recs.map((r) => r.id)).toEqual(["s1"]);
    recs = foldSchedule(recs, { version: 1, operation: "delete", id: "s1" });
    expect(recs).toEqual([]);
  });

  it("多条记录保持插入序", () => {
    let recs = foldSchedule([], { version: 1, operation: "create", schedule: at("a") });
    recs = foldSchedule(recs, { version: 1, operation: "create", schedule: at("b") });
    expect(recs.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
