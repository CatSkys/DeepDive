// 附件摄入判据（用户 2026-10-09 定稿）：图片收字节 chip，其余（文件与文件夹）一律 @ 引用
// ——没有大小上限；拿不到路径/图大到没法内联时当场说一句，绝不静默丢。
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { planIngest } from "../components/composer/attachmentIngest";
import type { PickedAttachment } from "../host";

const item = (p: Partial<PickedAttachment> & { name: string }): PickedAttachment =>
  ({ path: `/tmp/${p.name}`, isDir: false, ...p });

describe("planIngest：谁成 chip、谁成引用", () => {
  it("图片带字节 → chip（模型才看得见图）", () => {
    const plan = planIngest([item({ name: "shot.png", isImage: true, base64: "AAAA" })]);
    expect(plan.images).toEqual([{ data: "AAAA", mediaType: "image/png", name: "shot.png" }]);
    expect(plan.mentions).toEqual([]);
    expect(plan.notes).toEqual([]);
  });

  it("普通文件 → @ 引用，且不提示（引用本身就是可见的落点，不再弹窗）；没有大小上限", () => {
    const plan = planIngest([item({ name: "俞军 产品方法论.mobi" })]);
    expect(plan.images).toEqual([]);
    expect(plan.mentions).toEqual(['@"/tmp/俞军 产品方法论.mobi"']); // 名字带空格 → 带引号形态
    expect(plan.notes).toEqual([]);
  });

  it("文件夹 → @ 引用（与文件同一口径）", () => {
    const plan = planIngest([item({ name: "notes", isDir: true })]);
    expect(plan.mentions).toEqual(["@/tmp/notes/"]); // 无空格就不加引号，目录带尾斜杠
    expect(plan.notes).toEqual([]);
  });

  it("图片大到没法内联（没带字节）→ 转引用并**明说**，不是丢掉", () => {
    const plan = planIngest([item({ name: "huge.png", isImage: true })]);
    expect(plan.images).toEqual([]);
    expect(plan.mentions).toEqual(["@/tmp/huge.png"]);
    expect(plan.notes.join()).toContain("huge.png");
  });

  it("一批里混着文件夹与文件：顺序不变，都成引用", () => {
    const plan = planIngest([
      item({ name: "a.txt" }),
      item({ name: "docs", isDir: true }),
      item({ name: "clip.mp4" }),
    ]);
    expect(plan.mentions).toEqual(["@/tmp/a.txt", "@/tmp/docs/", "@/tmp/clip.mp4"]);
  });

  it("名字带空格的文件在引用里保持带引号（@\"…\" 形态，引擎语法要它）", () => {
    const plan = planIngest([item({ name: "my file.txt" })]);
    expect(plan.mentions[0]?.startsWith('@"')).toBe(true);
    expect(plan.mentions[0]?.endsWith('"')).toBe(true);
  });
});
