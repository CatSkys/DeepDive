// formatElapsed（AUD-047 收敛目的地）的档位边界：秒/分/时分三档与跨档进位。
// relativizePath：工具行摘要的项目内路径相对化（用户定稿）。
// browserSummary：浏览器控制行的摘要（title 优先 → 代码内 URL → 通用摘要）。
// commandDigest：终端命令的摘要（剥 cd 前缀 → 首行 → 截短；用户定稿：行右侧
// 是摘要不是命令原文）。
import { describe, expect, it } from "vitest";
import { browserSummary, commandDigest, compactElapsed, formatElapsed, relativizePath } from "../session/format";

describe("commandDigest 终端命令摘要", () => {
  it("剥掉开头的 cd … && 前缀（会话本就在那个目录，纯噪音）", () => {
    expect(commandDigest(JSON.stringify({ command: "cd /Users/me/DSHmini && npm run build" }))).toBe("npm run build");
    expect(commandDigest(JSON.stringify({ command: "cd /a b/c&& make package" }))).toBe("make package");
  });
  it("不碰无 cd 前缀的命令；多行取首行", () => {
    expect(commandDigest(JSON.stringify({ command: "rm -rf dist" }))).toBe("rm -rf dist");
    expect(commandDigest(JSON.stringify({ command: "echo one\necho two" }))).toBe("echo one");
  });
  it("超长截短到 60 字符加省略号", () => {
    const long = "hdiutil info | grep -i disk | head -20; echo wait; ps -p 1 2 3 4 5 6 7 8 9 10 11 12 13";
    const digest = commandDigest(JSON.stringify({ command: long }));
    expect(digest.endsWith("…")).toBe(true);
    expect(digest.length).toBe(61);
  });
});

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
