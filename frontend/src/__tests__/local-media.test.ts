// session/localMedia 的契约：只有视频才留 blob URL（渲染端判视频用的是同一套
// resolveFileIconName），超限逐出最旧的并释放 blob。
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { localMediaUrl, rememberLocalMedia, rememberUploadedMedia } from "../session/localMedia";

describe("localMedia", () => {
  it("rememberUploadedMedia：视频记下来，其余文件不记（留了也白占额度）", () => {
    const file = new Blob(["x"], { type: "video/mp4" });
    rememberUploadedMedia("v1", "clip.mp4", file);
    expect(localMediaUrl("v1")).toMatch(/^blob:/);
    rememberUploadedMedia("p1", "报告.pdf", file);
    expect(localMediaUrl("p1")).toBeUndefined();
  });

  it("超上限逐出最旧的，并释放它的 blob URL", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    for (let i = 0; i < 9; i++) rememberLocalMedia(`lru-${i}`, `blob:lru-${i}`);
    expect(localMediaUrl("lru-0")).toBeUndefined();
    expect(localMediaUrl("lru-8")).toBe("blob:lru-8");
    expect(revoke).toHaveBeenCalledWith("blob:lru-0");
    revoke.mockRestore();
  });
});
