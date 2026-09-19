// 澄清卡（QuestionCard）的提交行为：自定义回答回车即提交（selected 空 +
// custom 透传），提交成功后本地结算清卡——网关不给应答者回 cancel 帧，
// 卡片消失只能靠 settleEvent（官方 answer().then(clear) 同款）。
// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  api: {
    answerQuestion: vi.fn(async () => undefined),
    cancelQuestion: vi.fn(async () => undefined),
  },
}));

vi.mock("../i18n", () => ({
  t: (s: string) => s,
}));

vi.mock("../store", () => ({
  useStore: () => ({ settleEvent }),
}));

import { api } from "../api";
import { QuestionCard } from "../session/Cards";

const settleEvent = vi.fn();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const QUESTION = {
  id: "q1",
  question: "你想怎么处理？",
  options: [
    { label: "甲", description: "方案甲" },
    { label: "乙", description: "方案乙" },
  ],
};

describe("QuestionCard", () => {
  it("自定义回答回车提交：selected 为空、custom 透传，成功后本地清卡", async () => {
    const { container } = render(<QuestionCard eventId="ev1" questions={[QUESTION]} />);
    const input = container.querySelector(".q-custom input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "我自己来" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => {
      expect(api.answerQuestion).toHaveBeenCalledWith(
        "ev1",
        [{ id: "q1", selected: [], custom: "我自己来" }],
      );
      expect(settleEvent).toHaveBeenCalledWith("ev1");
    });
  });

  it("空自定义回答回车不提交", () => {
    const { container } = render(<QuestionCard eventId="ev1" questions={[QUESTION]} />);
    const input = container.querySelector(".q-custom input") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Enter" });
    expect(api.answerQuestion).not.toHaveBeenCalled();
    expect(settleEvent).not.toHaveBeenCalled();
  });

  it("发送钮与回车等价：输入后才出现，点击提交并本地清卡", async () => {
    const { container } = render(<QuestionCard eventId="ev1" questions={[QUESTION]} />);
    // 未输入时不渲染发送钮
    expect(container.querySelector(".q-custom .composer-send")).toBeNull();
    const input = container.querySelector(".q-custom input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "我自己来" } });
    const send = container.querySelector(".q-custom .composer-send") as HTMLButtonElement;
    expect(send).not.toBeNull();
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await vi.waitFor(() => {
      expect(api.answerQuestion).toHaveBeenCalledWith(
        "ev1",
        [{ id: "q1", selected: [], custom: "我自己来" }],
      );
      expect(settleEvent).toHaveBeenCalledWith("ev1");
    });
  });

  it("提交失败不清卡：留在卡片上可重试", async () => {
    vi.mocked(api.answerQuestion).mockRejectedValueOnce(new Error("engine busy"));
    const { container } = render(<QuestionCard eventId="ev1" questions={[QUESTION]} />);
    const input = container.querySelector(".q-custom input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "我自己来" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => {
      expect(api.answerQuestion).toHaveBeenCalled();
    });
    expect(settleEvent).not.toHaveBeenCalled();
    expect(container.querySelector(".question-card")).not.toBeNull();
  });
});
