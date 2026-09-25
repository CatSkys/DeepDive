// @vitest-environment jsdom
// 原生槽位的推送纪律：**槽位元素整块卸载时必须显式推 visible:false**——壳里的原生视图
// （侧栏浏览器的第二个 WKWebView）恒在 SPA 之上，不推的话它会沿用旧 rect 留在原地盖住
// 界面（面板收起、浏览器页换成空态都会让槽位元素消失）。jsdom 没有布局，rect 恒为 0、
// 命中测试也拿不到元素，所以这里只钉"发不发、发给谁"，不钉 visible 的取值。
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: Array<Record<string, unknown>> = [];

vi.mock("../host", () => ({
  inShell: () => true,
  sendToShell: (m: Record<string, unknown>) => { sent.push(m); },
}));

import { NATIVE_SLOT_ATTR, pushNativeSlots } from "../nativeSlot";

function mountSlot(id: string) {
  const el = document.createElement("div");
  el.setAttribute(NATIVE_SLOT_ATTR, id);
  document.body.appendChild(el);
  return el;
}

const idsSentTo = () => sent.map((m) => m.id);

beforeEach(() => {
  document.body.innerHTML = "";
  sent.length = 0;
});

describe("pushNativeSlots", () => {
  it("槽位在 DOM 里就推它一条", () => {
    mountSlot("browser");
    pushNativeSlots();
    expect(idsSentTo()).toEqual(["browser"]);
    expect(sent[0]?.type).toBe("native-slot");
  });

  it("槽位元素卸载后必须显式推一条 visible:false（不能什么都不发）", () => {
    mountSlot("browser");
    pushNativeSlots();
    sent.length = 0;
    document.body.innerHTML = "";   // 面板收起 / 浏览器页换成空态：元素整块消失
    pushNativeSlots();
    expect(idsSentTo()).toEqual(["browser"]);
    expect(sent[0]).toMatchObject({ id: "browser", visible: false, interactive: false });
  });

  it("从未出现过的槽位不推（别给壳发它没接过的 id）", () => {
    pushNativeSlots();
    expect(sent).toHaveLength(0);
  });
});
