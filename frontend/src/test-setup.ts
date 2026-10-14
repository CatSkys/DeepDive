// jsdom 缺的 DOM 接口补丁（只测试用，不进产品包）。收在这里而不是各用例就地补的理由：
// 缺的是**全局**接口，而触发它的是 CodeMirror 在 requestAnimationFrame 里的排版量测——
// 它抛出的是"测试全绿但整腿判失败"的那种未捕获异常（vitest 报 Errors 3）。
// 其余按用例需要就地补的（localStorage / ResizeObserver / matchMedia）仍在各测试文件里：
// 那些是"这个用例要什么就给什么"，与这里的"环境本身缺一块"不是一回事。
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
