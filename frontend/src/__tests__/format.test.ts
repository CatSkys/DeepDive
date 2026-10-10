// formatElapsed（AUD-047 收敛目的地）的档位边界：秒/分/时分三档与跨档进位。
// relativizePath：工具行摘要的项目内路径相对化（用户定稿）。
// browserSummary：浏览器控制行的摘要（title 优先 → 代码内 URL → 通用摘要）。
import { describe, expect, it } from "vitest";
import { browserSummary, compactElapsed, formatElapsed, relativizePath } from "../session/format";

describe("browserSummary", () => {
  it("有 title 给 title（模型给的这步人话描述）", () => {
    expect(browserSummary(JSON.stringify({ code: 'await b.navigate("https://x.com")', title: "打开 X 首页" }))).toBe("打开 X 首页");
  });
  it("无 title 退代码里的首个 URL（控制哪个页面）", () => {
    expect(browserSummary(JSON.stringify({ code: 'const el = await q("a"); fetch("https://example.com/page")' }))).toBe("https://example.com/page");
  });
  it("都没有退通用参数摘要（代码首行）", () => {
    expect(browserSummary(JSON.stringify({ code: "await b.title()\nawait b.screenshot()" }))).toBe("await b.title()");
    expect(browserSummary("不是 JSON")).toBe("不是 JSON");
  });
});

describe("relativizePath", () => {
  const cwd = "/Users/me/DSHmini";
  it("cwd 内的绝对路径剥前缀为项目内路径", () => {
    expect(relativizePath(`${cwd}/frontend/src/a.ts`, cwd)).toBe("frontend/src/a.ts");
  });
  it("项目外路径与无 cwd 时原样返回", () => {
    expect(relativizePath("/usr/local/bin/node", cwd)).toBe("/usr/local/bin/node");
    expect(relativizePath(`${cwd}/a.ts`, undefined)).toBe(`${cwd}/a.ts`);
  });
  it("仅剥整段前缀：同名前缀目录不误伤", () => {
    expect(relativizePath(`${cwd}-sibling/a.ts`, cwd)).toBe(`${cwd}-sibling/a.ts`);
  });
});

describe("formatElapsed", () => {
  it("秒档：<60s 输出整秒（向下取整）", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(59000)).toBe("59s");
    expect(formatElapsed(59900)).toBe("59s"); // 59.9s 向下取整
  });
  it("秒→分边界：60s 进分档", () => {
    expect(formatElapsed(60000)).toBe("1m 0s");
    expect(formatElapsed(119000)).toBe("1m 59s");
  });
  it("分档：秒恒在（用户定稿：分钟后没秒看不出在走）", () => {
    expect(formatElapsed(3599000)).toBe("59m 59s");
  });
  it("分→时边界：整 1h 进时分档", () => {
    expect(formatElapsed(3600000)).toBe("1h 0m 0s");
  });
  it("时分档：跨档进位（秒恒在）", () => {
    expect(formatElapsed(3660000)).toBe("1h 1m 0s");
    expect(formatElapsed(7199000)).toBe("1h 59m 59s"); // 1h59m59s
    expect(formatElapsed(2 * 3600000 + 5 * 60000 + 9000)).toBe("2h 5m 9s");
  });
});

describe("compactElapsed 紧凑时长（子智能体行右侧）", () => {
  it("小时 / 分 / 秒三档，且负值与不足一秒都钳到 0 秒", () => {
    expect(compactElapsed(3_600_000)).toBe("1 小时");
    expect(compactElapsed(2 * 3600_000)).toBe("2 小时");
    expect(compactElapsed(90_000)).toBe("1 分");
    expect(compactElapsed(42_000)).toBe("42 秒");
    expect(compactElapsed(400)).toBe("0 秒");
    expect(compactElapsed(-5)).toBe("0 秒");
  });
});
