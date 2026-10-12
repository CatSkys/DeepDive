// formatElapsed（AUD-047 收敛目的地）的档位边界：秒/分/时分三档与跨档进位。
// relativizePath：工具行摘要的项目内路径相对化（用户定稿）。
// browserSummary：浏览器控制行的摘要（title 优先 → 代码内 URL → 通用摘要）。
// bashSummary：终端行的摘要（引擎 bash 必填 description 优先 → 命令摘要回退；
// 用户定稿：行右侧是摘要不是命令原文，跟浏览器一个观感）。
// agentIdentity/agentSummary：子智能体委派行的身份串与摘要（引擎把 subagent 的
// description 定为"专给显示用的短描述"，也是子会话 label——三处头像 seed 的
// 唯一来源；用户定稿：行上不摆整段提示词）。
import { describe, expect, it } from "vitest";
import { agentIdentity, agentSummary, bashSummary, browserSummary, compactElapsed, formatElapsed, relativizePath } from "../session/format";

describe("agentIdentity/agentSummary 子智能体委派行", () => {
  const args = JSON.stringify({ description: "测试失败路径回报", prompt: "你是一个测试用子 Agent。本次任务专门测试\"失败路径如何回报\"。全部为只读/无副作用操作……" });
  it("摘要=description（不是 prompt 整段）；身份串=description 全文", () => {
    expect(agentSummary(args)).toBe("测试失败路径回报");
    expect(agentIdentity(args)).toBe("测试失败路径回报");
  });
  it("多行 description：摘要取首行，身份串保留全文", () => {
    const multi = JSON.stringify({ description: "第一行\n第二行", prompt: "p" });
    expect(agentSummary(multi)).toBe("第一行");
    expect(agentIdentity(multi)).toBe("第一行\n第二行");
  });
  it("缺 description / 空 description / 空白 description：身份串 undefined", () => {
    expect(agentIdentity(JSON.stringify({ prompt: "只有提示词" }))).toBeUndefined();
    expect(agentIdentity(JSON.stringify({ description: "", prompt: "p" }))).toBeUndefined();
    expect(agentIdentity(JSON.stringify({ description: "   " }))).toBeUndefined();
  });
  it("不是合法 JSON：摘要退通用参数摘要（首行），身份串 undefined", () => {
    expect(agentSummary("不是 JSON")).toBe("不是 JSON");
    expect(agentIdentity("不是 JSON")).toBeUndefined();
  });
});

describe("bashSummary 终端行摘要", () => {
  it("引擎 bash 的必填 description 优先（模型随调用写的动作短语）", () => {
    expect(bashSummary(JSON.stringify({ command: "ls -la", description: "List files in current directory" }))).toBe("List files in current directory");
    expect(bashSummary(JSON.stringify({ command: "git status", description: "查看工作区状态" }))).toBe("查看工作区状态");
  });
  it("无 description 回退命令摘要：剥掉开头的 cd … && 前缀（会话本就在那个目录）", () => {
    expect(bashSummary(JSON.stringify({ command: "cd /Users/me/DSHmini && npm run build" }))).toBe("npm run build");
    expect(bashSummary(JSON.stringify({ command: "cd /a b/c&& make package" }))).toBe("make package");
  });
  it("回退路径不碰无 cd 前缀的命令；多行取首行", () => {
    expect(bashSummary(JSON.stringify({ command: "rm -rf dist" }))).toBe("rm -rf dist");
    expect(bashSummary(JSON.stringify({ command: "echo one\necho two" }))).toBe("echo one");
  });
  it("回退路径超长截短到 60 字符加省略号", () => {
    const long = "hdiutil info | grep -i disk | head -20; echo wait; ps -p 1 2 3 4 5 6 7 8 9 10 11 12 13";
    const digest = bashSummary(JSON.stringify({ command: long }));
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
