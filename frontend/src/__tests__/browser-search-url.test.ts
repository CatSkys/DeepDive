// 地址解析的搜索那一半：明显是词的输入走搜索模板，像域名的仍当地址（参考实现 Address.url
// 的同一分工：先判"是不是地址"，判不出来才搜）。
import { describe, expect, it } from "vitest";
import { looksLikeSearch, searchUrlFor, shortAddress } from "../sidebar-right/browserUrl";

describe("搜索模板填充", () => {
  it("填 {q} 并做 URL 编码，保留其它参数", () => {
    expect(searchUrlFor("hello world", "https://www.bing.com/search?q={q}&src=dd"))
      .toBe("https://www.bing.com/search?q=hello%20world&src=dd");
  });
  it("模板没有 {q} / 不是 http(s) / 空词 → null（宁可当地址，不猜）", () => {
    expect(searchUrlFor("x", "https://example.com/search")).toBeNull();
    expect(searchUrlFor("x", "javascript:alert({q})")).toBeNull();
    expect(searchUrlFor("   ", "https://a.com/?q={q}")).toBeNull();
  });
});

describe("输入像不像搜索词", () => {
  it("带空格、没有点 → 搜索", () => {
    expect(looksLikeSearch("hello world")).toBe(true);
    expect(looksLikeSearch("影sir b站")).toBe(true);
    expect(looksLikeSearch("what")).toBe(true);
  });
  it("域名 / localhost / IPv4 → 地址", () => {
    expect(looksLikeSearch("bilibili.com")).toBe(false);
    expect(looksLikeSearch("https://bilibili.com/x")).toBe(false);
    expect(looksLikeSearch("localhost:56034")).toBe(false);
    expect(looksLikeSearch("127.0.0.1:8080/a")).toBe(false);
  });
});

describe("补全里的简写地址", () => {
  it("去 scheme 与 www.、去结尾斜杠；查询串与锚点不带", () => {
    expect(shortAddress("https://www.bilibili.com/")).toBe("bilibili.com");
    expect(shortAddress("https://search.bilibili.com/all?v=影")).toBe("search.bilibili.com/all");
    expect(shortAddress("http://localhost:56034/x/")).toBe("localhost:56034/x");
    expect(shortAddress("https://zh.wikipedia.org/wiki/WebKit#历史")).toBe("zh.wikipedia.org/wiki/WebKit");
  });
  it("解析不出的原样返回（历史里只可能有解析过的地址，这是兜底形状不是兜底逻辑）", () => {
    expect(shortAddress("不是地址")).toBe("不是地址");
  });
});
