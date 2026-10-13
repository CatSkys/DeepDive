// 划词命令目录纯函数（settings/selectionCommands.ts）：提示词渲染、解析容错、
// 内置目录完整性。渲染规则是「模板里的 {{input}} 换掉、没写就接末尾」，解析规则是
// 「没存过才回内置种子，存过照存的说」——两条都有代价（少写占位符 / 删空目录），钉死。
import { describe, expect, it } from "vitest";
import {
  builtinSelectionCommands, INPUT_PLACEHOLDER, MAX_SELECTION_COMMANDS,
  parseSelectionCommands, renderSelectionPrompt, type SelectionCommand,
} from "../settings/selectionCommands";

const cmd = (over: Partial<SelectionCommand> = {}): SelectionCommand => ({
  id: "x", name: "X", prompt: "Do it.", enabled: true, ...over,
});

describe("renderSelectionPrompt", () => {
  it("模板里的 {{input}} 换成选中的文字（多处都换）", () => {
    const out = renderSelectionPrompt(cmd({ prompt: "A:\n{{input}}\nB:\n{{input}}" }), "  正文  ");
    expect(out).toBe("A:\n正文\nB:\n正文");
  });

  it("模板没写占位符就接在末尾（用户忘了写不至于把正文丢了）", () => {
    expect(renderSelectionPrompt(cmd({ prompt: "Do it." }), "正文")).toBe("Do it.\n\n正文");
  });

  it("正文两端空白先剪掉（选区常带尾部换行）", () => {
    expect(renderSelectionPrompt(cmd({ prompt: "{{input}}" }), "\n 正文 \n")).toBe("正文");
  });
});

describe("builtinSelectionCommands", () => {
  it("id 唯一、名字非空、每条渲染后都带着正文", () => {
    const list = builtinSelectionCommands();
    expect(new Set(list.map((c) => c.id)).size).toBe(list.length);
    for (const c of list) {
      expect(c.name.trim()).not.toBe("");
      expect(c.prompt).toContain(INPUT_PLACEHOLDER);
      expect(renderSelectionPrompt(c, "选中的正文")).toContain("选中的正文");
    }
  });

  it("每次调用都给一份新数组（调用方要就地改）", () => {
    const a = builtinSelectionCommands();
    a[0].name = "改了";
    expect(builtinSelectionCommands()[0].name).not.toBe("改了");
  });
});

describe("parseSelectionCommands", () => {
  it("没存过（空 / 坏 JSON / 不是数组）回内置种子", () => {
    const ids = builtinSelectionCommands().map((c) => c.id);
    for (const raw of ["", null, undefined, "{", '"x"', "{}"]) {
      expect(parseSelectionCommands(raw).map((c) => c.id)).toEqual(ids);
    }
  });

  it("存过就照存的说——空数组是用户全删了，不补回内置", () => {
    expect(parseSelectionCommands("[]")).toEqual([]);
  });

  it("丢弃缺字段与重 id 的条目，enabled 缺省为开", () => {
    const list = parseSelectionCommands(JSON.stringify([
      { id: "a", name: "A", prompt: "p" },
      { id: "a", name: "重复", prompt: "p" },
      { id: "", name: "空 id", prompt: "p" },
      { id: "b", name: "B" },
      { name: "没 id", prompt: "p" },
      null,
      { id: "c", name: "C", prompt: "p", enabled: false },
    ]));
    expect(list).toEqual([
      { id: "a", name: "A", prompt: "p", enabled: true },
      { id: "c", name: "C", prompt: "p", enabled: false },
    ]);
  });

  it("超过上限截断", () => {
    const many = Array.from({ length: MAX_SELECTION_COMMANDS + 5 }, (_, i) => ({
      id: `c${i}`, name: `C${i}`, prompt: "p", enabled: true,
    }));
    expect(parseSelectionCommands(JSON.stringify(many))).toHaveLength(MAX_SELECTION_COMMANDS);
  });
});
