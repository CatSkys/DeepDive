// 归档/删除的本地覆盖（纯函数）：视图侧即时生效与观察收敛两条规矩。
// 背景：引擎无取消归档/删除 RPC 且把会话列表缓存在内存（实测运行中删目录后
// session/list 照样列它），所以 UI 的即时真相是本地覆盖集。
import { describe, expect, it } from "vitest";
import { converged, visibleArchived, visibleSessions } from "../sessionOverrides";

describe("visibleArchived", () => {
  it("摘掉本地取消归档与已删除的", () => {
    const out = visibleArchived(new Set(["a", "b", "c"]), new Set(["a"]), new Set(["b"]));
    expect([...out]).toEqual(["c"]);
  });

  it("无覆盖时原样返回", () => {
    expect([...visibleArchived(new Set(["a"]), new Set(), new Set())]).toEqual(["a"]);
  });
});

describe("visibleSessions", () => {
  it("摘掉本地已删除的，且不改原数组", () => {
    const src = [{ sessionId: "a" }, { sessionId: "b" }];
    expect(visibleSessions(src, new Set(["a"])).map((s) => s.sessionId)).toEqual(["b"]);
    expect(src).toHaveLength(2);
  });
});

describe("converged", () => {
  it("引擎仍报告已归档 / 仍列出时保留覆盖；不再报/不再列时收敛", () => {
    // liveArchived 仍含 x → x 的"已取消归档"覆盖还要继续压着引擎的说法（保留）
    // liveArchived 不含 y → 引擎已不认为 y 归档 → 覆盖可以丢
    // liveSessionIds 仍含 keep → keep 的"已删除"覆盖保留；z 已不在列表 → 收敛
    const gone = converged(new Set(["x"]), new Set(["keep"]), new Set(["x", "y"]), new Set(["z", "keep"]));
    expect(gone.unarchived).toEqual(["y"]);
    expect(gone.removed).toEqual(["z"]);
  });

  it("引擎状态还没跟上时不动覆盖（两者都不收敛）", () => {
    const gone = converged(new Set(["y"]), new Set(["z"]), new Set(["y"]), new Set(["z"]));
    expect(gone).toEqual({ unarchived: [], removed: [] });
  });
});
