// 会话头角落座位的**点击落点**：浏览器那一级点开的是面板的浏览器页（去看 agent 在看的
// 页面），其余各级仍是状态面板。这条分流是"用户不知道去哪儿看浏览器"的修复本体，
// 用假数据钉住它（真链路的取数与回落链在 capsule / browserFace / session-ingest 各自有测）。
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { data } = vi.hoisted(() => ({
  data: { pill: null as unknown },
}));
vi.mock("../sidebar-right/useCapsuleData", () => ({
  useCapsuleData: () => data,
}));
vi.mock("../sidebar-right/browserFace", () => ({
  useBrowserFace: () => ({ title: "示例页", url: "https://example.com", loading: false }),
}));
vi.mock("../i18n", () => ({
  t: (text: string) => text,
  tt: (zh: string) => zh,
}));

import { PanelTrigger } from "../sidebar-right/PanelTrigger";
import { panelActions, usePanelSurface } from "../sidebar-right/panelStore";

function Probe({ sessionId }: { sessionId: string }) {
  const surface = usePanelSurface(sessionId);
  return <div data-testid="surface">{`${surface.open}|${surface.fullscreen}|${surface.mode}`}</div>;
}

function seat(pill: unknown) {
  data.pill = pill;
  return render(
    <>
      <PanelTrigger sessionId="s1" scheduleRecords={[]} browser={{ used: true, live: false }} />
      <Probe sessionId="s1" />
    </>,
  );
}

beforeEach(() => panelActions.reset());
afterEach(cleanup);

describe("PanelTrigger 的点击落点", () => {
  it("浏览器那一级：点开面板的浏览器页（push 之上进全屏呈现，与点缩略图同一动作）", () => {
    seat({ kind: "browser", title: "示例页", live: false });
    expect(screen.getByText("示例页")).toBeTruthy();
    expect(screen.getByRole("button").getAttribute("data-tip")).toBe("查看浏览器");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("surface").textContent).toBe("true|true|browser");
  });

  it("其余各级：照旧开状态面板（默认页，不全屏）", () => {
    seat({ kind: "todo", text: "写文档", done: 0, total: 1 });
    expect(screen.getByRole("button").getAttribute("data-tip")).toBe("展开状态");
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("surface").textContent).toBe("true|false|session");
  });

  it("胶囊没有内容：渲染展开按钮，点开还是状态面板", () => {
    seat(null);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("surface").textContent).toBe("true|false|session");
  });
});
