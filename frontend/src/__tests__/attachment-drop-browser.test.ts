// 纯浏览器（没有壳）的兜底摄入：只收同步拿得到的东西。这条是**回归钉子**——
// 旧实现拿 `getAsString` 求文件夹路径，而 WebKit 对文件项根本不回调它（实测），
// 于是整个 Promise.all 永不 settle、整批（连夹带的文件）一个都不摄入：
// 用户看到的就是"文件夹拖入不显示"。现在文件夹走同步判定 + 明说，绝不挂住。
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const alerts: string[] = [];
vi.mock("../components/DialogHost", () => ({
  alertDialog: (o: { message: string }) => { alerts.push(o.message); return Promise.resolve(); },
}));

import { ingestBrowserDrop } from "../components/composer/useComposerAttachments";

/** 造一个 DataTransferItem 替身：getAsString 永不回调（真机 WebKit 就是这样）。 */
const dtItem = (file: File | null, isDir = false) => ({
  kind: "file",
  getAsFile: () => file,
  webkitGetAsEntry: () => (file || isDir ? { isDirectory: isDir, isFile: !isDir } : null),
  getAsString: () => { /* 永不回调：新实现不许依赖它 */ },
});

const dt = (items: unknown[], files: File[] = []) => ({ items, files } as unknown as DataTransfer);

beforeEach(() => { alerts.length = 0; });

describe("ingestBrowserDrop（无壳兜底）", () => {
  it("图片收下（面板照旧长 chip）", () => {
    const add = vi.fn();
    const img = new File(["x"], "shot.png", { type: "image/png" });
    ingestBrowserDrop(dt([dtItem(img)]), add);
    expect(add).toHaveBeenCalledWith(img);
    expect(alerts).toEqual([]);
  });

  it("非图片文件：这里没有路径可引用 → 明说，不假装收下", () => {
    const add = vi.fn();
    ingestBrowserDrop(dt([dtItem(new File(["x"], "clip.mp4", { type: "video/mp4" }))]), add);
    expect(add).not.toHaveBeenCalled();
    expect(alerts.join()).toContain("clip.mp4");
  });

  it("文件夹拖入不会挂住整批：文件夹明说，同批的图片照样收下", () => {
    const add = vi.fn();
    const img = new File(["x"], "shot.png", { type: "image/png" });
    ingestBrowserDrop(dt([dtItem(null, true), dtItem(img)]), add);
    expect(add).toHaveBeenCalledWith(img);          // 不再被文件夹连坐
    expect(alerts.join()).toContain("文件夹");
  });
});
