// jsdom 缺的浏览器接口补丁（只测试用，不进产品包）。收在这里而不是各用例就地补的理由：
// 这些都是 jsdom「压根没实现」的全局接口（Range 量文本 / matchMedia / ResizeObserver），
// 谁渲染到用它们的组件谁就需要——每处各补一遍既重复又容易漏（CodeMirror 量排版那次就是
// 漏在 rAF 里抛，表现成"测试全绿但整腿判失败"，vitest 报 Errors 3）。
// 各用例**自己要的**东西（localStorage 之类）仍在各测试文件里就地补。
// 没跑在 jsdom 里的用例（纯函数那批跑在 node）压根没有 DOM——这个文件对它们必须是空操作
if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function () {
    return { length: 0, item: () => null, [Symbol.iterator]: Array.prototype[Symbol.iterator] } as unknown as DOMRectList;
  };
}
if (typeof Range !== "undefined" && !Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
  };
}

if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}
