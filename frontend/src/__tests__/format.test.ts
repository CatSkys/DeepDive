// formatElapsed（AUD-047 收敛目的地）的档位边界：秒/分/时分三档与跨档进位。
import { describe, expect, it } from "vitest";
import { formatElapsed } from "../session/format";

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
