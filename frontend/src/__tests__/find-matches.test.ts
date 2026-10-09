// 会话页内查找的取词：根元素 + 查找词 → 一组 Range（大小写不敏感、有上限）。
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { collectMatches, FIND_CAP } from "../session/findMatches";

const root = (html: string) => {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
};

const texts = (ranges: Range[]) => ranges.map((r) => r.toString());

describe("collectMatches 取词", () => {
  it("同一个文本节点里的多处命中都取到，且大小写不敏感", () => {
    const spans = collectMatches(root("<p>海风穿过机房，海风很轻，HAI 风</p>"), "海风");
    expect(texts(spans)).toEqual(["海风", "海风"]);
    expect(texts(collectMatches(root("<p>Machine room</p>"), "machine"))).toEqual(["Machine"]);
  });

  it("空词/纯空白不算词：没有命中，也不会返回整篇", () => {
    expect(collectMatches(root("<p>海风</p>"), "")).toEqual([]);
    expect(collectMatches(root("<p>海风</p>"), "   ")).toEqual([]);
  });

  it("跨节点被拆开的串找不到（原生查找能跨；代价是改写 DOM，见文件头边界）", () => {
    expect(collectMatches(root("<p>海<strong>风</strong>很轻</p>"), "海风")).toEqual([]);
  });

  it("脚本与样式里的字不算内容", () => {
    expect(collectMatches(root("<style>.a{color:red}</style><p>color</p>"), "color")).toHaveLength(1);
    expect(collectMatches(root("<script>var color=1</script><p>color</p>"), "color")).toHaveLength(1);
  });

  it("命中数有上限（长会话里几千个 Range 会拖死重排）", () => {
    const many = collectMatches(root(`<p>${"海风".repeat(FIND_CAP + 50)}</p>`), "海风");
    expect(many).toHaveLength(FIND_CAP);
  });

  it("Range 落在原文本节点上：起点终点就是词的边界", () => {
    const [first] = collectMatches(root("<p>abc 海风 def</p>"), "海风");
    expect(first.startOffset).toBe(4);
    expect(first.endOffset).toBe(6);
    expect(first.startContainer.nodeType).toBe(Node.TEXT_NODE);
  });
});
