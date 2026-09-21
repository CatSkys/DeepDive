// @vitest-environment jsdom
// 流式期间的成本契约（TODO §16 的触发侧）：会话在跑时每条增量都会重渲整棵消息
// 列表，第一道闸是 Markdown 的 memo —— 它让未变化的文本跳过 parseBlocks + 全量
// reconcile。memo 只做浅比较，所以 onOpenFile 必须引用稳定；调用点（SessionView）
// 用 useCallback 把 preview.open + absPreviewPath 收敛成一个稳定引用。
//
// 量法：把真实 Markdown 包一层同样用默认浅比较的 memo 代理，数它「真正放行渲染」
// 的次数——代理与真实组件的裁决函数（props 浅比较）完全一致，所以计数等于真实
// 重渲次数。不能用 CodeBlock 渲染次数代：块级元素缓存会复用上次的元素对象，
// 渲染体跑了 CodeBlock 也不重渲，量出来两种写法都是 1（探针量错对象）。
import { memo, useState } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const probes = vi.hoisted(() => ({ mdRenders: 0 }));

vi.mock("../components/Markdown", async () => {
  const actual = await vi.importActual<typeof import("../components/Markdown")>("../components/Markdown");
  return {
    ...actual,
    Markdown: memo((props: { text: string; onOpenFile?: (path: string, line?: number) => void }) => {
      probes.mdRenders += 1;
      return <actual.Markdown {...props} />;
    }),
  };
});

import { Markdown } from "../components/Markdown";

afterEach(cleanup);

const TEXT = "正文";
/** 模块级常量：等价于 SessionView 里 useCallback 出来的那个引用。 */
const STABLE_OPEN = () => undefined;

/** 稳定引用（改动后的写法）。 */
function StableParent() {
  const [, tick] = useState(0);
  return (
    <>
      <button type="button" onClick={() => tick((n) => n + 1)}>重渲</button>
      <Markdown text={TEXT} onOpenFile={STABLE_OPEN} />
    </>
  );
}

/** 内联箭头：改动前 SessionView 的写法，每次渲染换新引用。 */
function FreshParent() {
  const [, tick] = useState(0);
  return (
    <>
      <button type="button" onClick={() => tick((n) => n + 1)}>重渲</button>
      <Markdown text={TEXT} onOpenFile={() => undefined} />
    </>
  );
}

describe("Markdown 的 memo 依赖稳定引用", () => {
  it("onOpenFile 引用稳定：父组件重渲不带动正文重渲（memo 命中）", () => {
    probes.mdRenders = 0;
    const { getByRole } = render(<StableParent />);
    expect(probes.mdRenders).toBe(1); // 首挂
    act(() => { getByRole("button").click(); }); // 父组件重渲（等价于流式期间的一次增量）
    expect(probes.mdRenders).toBe(1);
  });

  it("onOpenFile 每次新建（内联箭头）：正文跟着重渲——旧写法的成本就在这", () => {
    probes.mdRenders = 0;
    const { getByRole } = render(<FreshParent />);
    expect(probes.mdRenders).toBe(1);
    act(() => { getByRole("button").click(); });
    expect(probes.mdRenders).toBe(2);
  });
});
