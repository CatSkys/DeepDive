// 附件令牌的换算：文档文本（正文 + 哨兵令牌）↔ 纯文本 ↔ 分段。
// 这三样是发送载荷、菜单插入点、光标位的共同依据，算错了不会报错、只表现为
// "插入落在了错的字后面"或"发出去的顺序不对"，所以单独钉死。
import { describe, expect, it } from "vitest";
import {
  addTokens, docOffset, documentOf, plainOffset, plainOf, segmentsOf, SENTINELS, tokenEntry, tokenOf, tokenTable,
} from "../components/composer/editor/attachmentTokens";
import { EditorState } from "@codemirror/state";

/** 造一份文档 + 表：三个正文段夹两颗附件（与用户插附件后的样子同形）。 */
function makeDoc() {
  const { doc, entries } = documentOf(["前面的话", { attachmentId: "a1" }, "中间", { attachmentId: "a2" }, "结尾"]);
  const state = EditorState.create({ doc, extensions: [tokenTable.init(() => new Map(entries.map((e) => [e.id, e.attachmentId])))] });
  return { doc, table: state.field(tokenTable) };
}

describe("附件令牌", () => {
  it("纯文本把令牌整段丢掉", () => {
    const { doc, table } = makeDoc();
    expect(plainOf(doc, table)).toBe("前面的话中间结尾");
  });

  it("分段按文档序：文本段与附件交替", () => {
    const { doc, table } = makeDoc();
    expect(segmentsOf(doc, table)).toEqual([
      "前面的话", { attachmentId: "a1" }, "中间", { attachmentId: "a2" }, "结尾",
    ]);
  });

  it("纯文本坐标 → 文档坐标：目标前面的令牌长度要补回去", () => {
    const { doc, table } = makeDoc();
    // 纯文本 "前面的话中间结尾"：0=开头、4=第一颗胶囊处、6=第二颗胶囊处、8=结尾
    expect(docOffset(0, doc, table)).toBe(0);
    expect(docOffset(4, doc, table)).toBe(4); // 正好在第一颗令牌前
    expect(docOffset(6, doc, table)).toBe(doc.indexOf("中") + 2); // 第一颗之后、中间之后
    expect(docOffset(8, doc, table)).toBe(doc.length);
  });

  it("文档坐标 → 纯文本坐标：光标位（落在令牌里就算令牌前面）", () => {
    const { doc, table } = makeDoc();
    const tokenFrom = doc.indexOf("\uE000");
    expect(plainOffset(0, doc, table)).toBe(0);
    expect(plainOffset(tokenFrom, doc, table)).toBe(4);
    // 令牌内部（理论上光标不会落进去，原子范围会跨过它）：算在令牌前面
    expect(plainOffset(tokenFrom + 1, doc, table)).toBe(4);
    expect(plainOffset(doc.length, doc, table)).toBe(8);
  });

  it("词表只增不删：撤销把令牌救回来时还查得出是哪颗附件", () => {
    const entry = tokenEntry("a9");
    let state = EditorState.create({ doc: "", extensions: [tokenTable] });
    state = state.update({ changes: { from: 0, insert: tokenOf(entry.id) }, effects: addTokens.of([entry]) }).state;
    const removed = state.update({ changes: { from: 0, to: state.doc.length } }).state;
    expect(removed.field(tokenTable).get(entry.id)).toBe("a9");
  });

  it("游离哨兵（粘贴走样）不算令牌，读纯文本时也剥掉", () => {
    const state = EditorState.create({ doc: "", extensions: [tokenTable] });
    const table = state.field(tokenTable);
    const stray = `a\uE000b\uE001c`;
    expect(segmentsOf(stray, table)).toEqual(["abc"]);
    expect(plainOf(stray, table)).toBe("abc");
    expect("a\uE000b".replace(SENTINELS, "")).toBe("ab");
  });
});
