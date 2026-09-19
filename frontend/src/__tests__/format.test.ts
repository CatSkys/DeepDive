// formatElapsed（AUD-047 收敛目的地）的档位边界：秒/分/时分三档与跨档进位。
// relativizePath：工具行摘要的项目内路径相对化（用户定稿）。
import { describe, expect, it } from "vitest";
import { formatElapsed, relativizePath } from "../session/format";

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
    expect(formatElapsed(60000)).toBe("1m");
    expect(formatElapsed(119000)).toBe("1m"); // 1m59s → "1m"
  });
  it("分档：<60m 输出整分（丢弃秒）", () => {
    expect(formatElapsed(3599000)).toBe("59m"); // 59m59s → "59m"
  });
  it("分→时边界：整 1h 进时分档", () => {
    expect(formatElapsed(3600000)).toBe("1h 0m");
  });
  it("时分档：跨档进位（1h1m / 多小时）", () => {
    expect(formatElapsed(3660000)).toBe("1h 1m");
    expect(formatElapsed(7199000)).toBe("1h 59m"); // 1h59m59s
    expect(formatElapsed(2 * 3600000 + 5 * 60000)).toBe("2h 5m");
  });
});
