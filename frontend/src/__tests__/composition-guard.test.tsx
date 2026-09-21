// 输入法组合态守卫的回归面（frontend/src/useCompositionGuard.ts）：
// 1）被吞掉的余波回车必须 preventDefault——否则 textarea 落一个换行，正是用户
//    报的"按回车发送变成换行，得删掉重发"；
// 2）输入法自己那一击（isComposing）不能拦，候选词导航靠它；
// 3）不在组合余波里的普通回车照常走发送。
// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCompositionGuard } from "../useCompositionGuard";

/** 最小宿主：与 Composer 同款接线（组合起止进守卫，回车先过守卫再发送）。 */
function Harness({ onSend }: { onSend: () => void }) {
  const ime = useCompositionGuard();
  return (
    <textarea
      data-testid="ta"
      onCompositionStart={ime.onCompositionStart}
      onCompositionEnd={ime.onCompositionEnd}
      onKeyDown={(e) => {
        if (ime.swallow(e)) return;
        onSend();
      }}
    />
  );
}

const keyDown = (el: HTMLElement, init: KeyboardEventInit) => {
  const event = createEvent.keyDown(el, init);
  fireEvent(el, event);
  return event;
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useCompositionGuard", () => {
  it("组合中确认词的回车余波：吞掉且拦默认行为（不落换行）", () => {
    const onSend = vi.fn();
    const { getByTestId } = render(<Harness onSend={onSend} />);
    const ta = getByTestId("ta");
    fireEvent.compositionStart(ta);
    fireEvent.compositionEnd(ta);

    const event = keyDown(ta, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("组合中（isComposing）的回车：吞掉但不拦，输入法候选不受打扰", () => {
    const onSend = vi.fn();
    const { getByTestId } = render(<Harness onSend={onSend} />);
    const ta = getByTestId("ta");
    fireEvent.compositionStart(ta);

    const event = keyDown(ta, { key: "Enter", isComposing: true });

    expect(onSend).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("余波窗口过后（隔一拍再按）回车照常发送", () => {
    vi.useFakeTimers();
    const onSend = vi.fn();
    const { getByTestId } = render(<Harness onSend={onSend} />);
    const ta = getByTestId("ta");
    fireEvent.compositionStart(ta);
    fireEvent.compositionEnd(ta);

    vi.advanceTimersByTime(1000);
    const event = keyDown(ta, { key: "Enter" });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it("没碰过输入法的回车不受影响", () => {
    const onSend = vi.fn();
    const { getByTestId } = render(<Harness onSend={onSend} />);
    keyDown(getByTestId("ta"), { key: "Enter" });

    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
