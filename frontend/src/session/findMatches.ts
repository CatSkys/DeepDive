// 会话页内查找的取词：把「根元素 + 查找词」变成一组 Range（CSS Custom Highlight 的原料）。
// 只管找，不管上色、滚动与键盘（那些在 components/FindInConversation.tsx）。
//
// 两条边界：① 命中数有上限——长会话里往下翻的时间比找更贵，几千个 Range 会拖死重排；
// ② 只认**同一个文本节点内**的命中：跨 <strong>/<code> 边界被拆开的串找不到（原生查找
// 能跨，代价是要改写 DOM，而 DOM 是 React 的、流式还在往里写）。

/** 一次查找最多画这么多处。 */
export const FIND_CAP = 400;

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"]);

/** 根元素下所有含查找词的文本片段（大小写不敏感，空白串不算词）。 */
export function collectMatches(root: HTMLElement, query: string): Range[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const out: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node: Node) => {
      const parent = node.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return (node as Text).data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  for (let node = walker.nextNode() as Text | null; node && out.length < FIND_CAP; node = walker.nextNode() as Text | null) {
    const hay = node.data.toLowerCase();
    for (let at = hay.indexOf(needle); at !== -1 && out.length < FIND_CAP; at = hay.indexOf(needle, at + needle.length)) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      out.push(range);
    }
  }
  return out;
}
