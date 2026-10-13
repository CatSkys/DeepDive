// 迷你面板页「显示哪张脸」的判定：会话刚建出来、内容还没落盘（summary 未到或仍
// blank）时必须留在面板自己的草稿页。交给 SessionView，它会先渲染主窗那套
// 「空白会话 → 头部 + hero 整页」——在面板里闪一帧就是用户 2026-10-13 报的
// "发送后中间跳一下"（主窗不报，因为它那份草稿页就是那张 hero）。
// 判定本身是纯函数，这里只锁它，不搭 DOM。
import { describe, expect, it } from "vitest";
import { miniPanelFace } from "../minipanel/MiniPanelApp";

describe("miniPanelFace", () => {
  it("没有活动会话（草稿页）= draft", () => {
    expect(miniPanelFace(null, [])).toBe("draft");
  });

  it("会话刚建出来、还没有内容（blank）= draft", () => {
    expect(miniPanelFace("s1", [{ sessionId: "s1", blank: true }])).toBe("draft");
  });

  it("summary 还没到（列表里找不到这条会话）= draft", () => {
    expect(miniPanelFace("s1", [{ sessionId: "s2" }])).toBe("draft");
  });

  it("会话有内容 = session", () => {
    expect(miniPanelFace("s1", [{ sessionId: "s1", blank: false }])).toBe("session");
  });
});
