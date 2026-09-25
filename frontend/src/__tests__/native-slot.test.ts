// @vitest-environment jsdom
// 原生槽位的推送纪律：一是**发对通道**（`deepdive` rect 表通道；发到 `deepdiveHost` 会被
// 壳当指令走 case 表、槽位永远摆不出来——本模块曾这么错过一次，表现为"侧栏浏览器一直
// 空白"），二是**槽位元素整块卸载时必须显式推 visible:false**（原生视图恒在 SPA 之上，
// 不推的话它沿用旧 rect 留在原地盖住界面）。jsdom 没有布局，rect 恒为 0、命中测试也拿不到
// 元素，所以这里只钉"发不发、发给谁、走哪个通道"，不钉 visible 的取值。
import { beforeEach, describe, expect, it, vi } from "vitest";

const rects: Array<Record<string, unknown>> = [];
const commands: Array<Record<string, unknown>> = [];

vi.mock("../host", () => ({
  inShell: () => true,
  sendRects: (m: Record<string, unknown>) => { rects.push(m); },
  sendToShell: (m: Record<string, unknown>) => { commands.push(m); },
}));

import { NATIVE_SLOT_ATTR, pushNativeSlots } from "../nativeSlot";

function mountSlot(id: string) {
  const el = document.createElement("div");
  el.setAttribute(NATIVE_SLOT_ATTR, id);
  document.body.appendChild(el);
  return el;
}

const idsSentTo = () => rects.map((m) => m.id);

beforeEach(() => {
  document.body.innerHTML = "";
  rects.length = 0;
  commands.length = 0;
});

describe("pushNativeSlots", () => {
  it("槽位在 DOM 里就经 rect 表通道推它一条", () => {
    mountSlot("browser");
    pushNativeSlots();
    expect(idsSentTo()).toEqual(["browser"]);
    expect(rects[0]?.type).toBe("native-slot");
    expect(commands).toHaveLength(0);   // 不许走指令通道
  });

  it("槽位元素卸载后必须显式推一条 visible:false（不能什么都不发）", () => {
    mountSlot("browser");
    pushNativeSlots();
    rects.length = 0;
    document.body.innerHTML = "";   // 面板收起 / 浏览器页换成空态：元素整块消失
    pushNativeSlots();
    expect(idsSentTo()).toEqual(["browser"]);
    expect(rects[0]).toMatchObject({ id: "browser", visible: false, interactive: false });
  });

  it("从未出现过的槽位不推（别给壳发它没接过的 id）", () => {
    pushNativeSlots();
    expect(rects).toHaveLength(0);
  });
});
