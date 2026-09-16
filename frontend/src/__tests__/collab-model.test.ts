// 会话协作分区的纯逻辑规格：联系人边界校验（localStorage 是外部输入，坏行整条丢）、
// 消息始终追加为最后一个参数。
import { describe, expect, it } from "vitest";
import { agentArgv, parseAgentContacts } from "../collab/model";

describe("parseAgentContacts", () => {
  it("正常行读出来，args 只收字符串项", () => {
    const raw = JSON.stringify([{ id: "1", name: "Claude Code", command: "claude", args: ["-p", 7, null] }]);
    expect(parseAgentContacts(raw)).toEqual([{ id: "1", name: "Claude Code", command: "claude", args: ["-p"] }]);
  });

  it("坏 JSON / 非数组 / 缺关键字段的行一律丢，不做兜底", () => {
    expect(parseAgentContacts(null)).toEqual([]);
    expect(parseAgentContacts("{ not json")).toEqual([]);
    expect(parseAgentContacts('{"id":"1"}')).toEqual([]);
    expect(parseAgentContacts(JSON.stringify([
      { id: "1", name: "", command: "claude" },
      { id: "", name: "x", command: "claude" },
      { id: "2", name: "x", command: "" },
      { id: "3", name: "ok", command: "claude" },
    ]))).toEqual([{ id: "3", name: "ok", command: "claude", args: [] }]);
  });

  it("名称与命令两端空白被去掉", () => {
    const raw = JSON.stringify([{ id: "1", name: "  Claude  ", command: "  claude  ", args: [] }]);
    expect(parseAgentContacts(raw)[0]).toMatchObject({ name: "Claude", command: "claude" });
  });
});

describe("agentArgv", () => {
  it("消息追加在固定参数之后（claude -p \"<msg>\" 形态）", () => {
    const contact = { id: "1", name: "c", command: "claude", args: ["-p"] };
    expect(agentArgv(contact, "  看看这个  ")).toEqual(["-p", "看看这个"]);
  });

  it("空消息不发（只跑固定参数没有意义）", () => {
    expect(agentArgv({ id: "1", name: "c", command: "claude", args: ["-p"] }, "   ")).toBeNull();
  });
});
