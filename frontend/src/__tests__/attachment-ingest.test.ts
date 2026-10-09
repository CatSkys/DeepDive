// 附件摄入的两条判据（用户 2026-10-09 定稿"一律 chip、大小不设限"）：
// ① 拖入分类**同步**判文件夹、不碰 getAsString（旧实现挂在它上面，整批静默丢）；
// ② 选择器结果：图片→字节 chip，文件→上传 chip（拿不到字节的交给壳按路径上传），
//    文件夹→@ 引用。
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("../components/DialogHost", () => ({ alertDialog: () => Promise.resolve() }));
vi.mock("../session/localMedia", () => ({ rememberUploadedMedia: () => {} }));

import { classifyDrop, ingestPicked } from "../components/composer/useComposerAttachments";
import type { PickedAttachment } from "../host";

/** DataTransferItem 替身：getAsString **永不回调**（真机 WebKit 就是这样），
 *  谁依赖它就会挂住——那是这次事故的机制。 */
const item = (file: File | null, isDir = false) => ({
  kind: "file",
  getAsFile: () => file,
  webkitGetAsEntry: () => (file || isDir ? { isDirectory: isDir, isFile: !isDir, name: "x", fullPath: "/x" } : null),
  getAsString: () => { /* 永不回调 */ },
});

const dt = (items: unknown[], files: File[] = []) => ({ items, files } as unknown as DataTransfer);
const picked = (p: Partial<PickedAttachment> & { name: string }): PickedAttachment =>
  ({ path: `/tmp/${p.name}`, isDir: false, ...p });

describe("classifyDrop：文件夹不再把整批拖死", () => {
  it("目录单独计数，文件照收——同步就分完了，不等任何回调", () => {
    const a = new File(["a"], "a.txt", { type: "text/plain" });
    const r = classifyDrop(dt([item(null, true), item(a)]));
    expect(r.dirs).toBe(1);
    expect(r.files.map((f) => f.name)).toEqual(["a.txt"]);
  });

  it("没有 items 的旧环境按 dt.files 收（文件夹本来就不在里面）", () => {
    const a = new File(["a"], "a.txt", { type: "text/plain" });
    expect(classifyDrop(dt([], [a])).files).toHaveLength(1);
  });
});

describe("ingestPicked：一律 chip，大小不设限", () => {
  const run = (items: PickedAttachment[]) => {
    const chips: Array<Record<string, unknown>> = [];
    const paths: Array<[string, string]> = [];
    const texts: string[] = [];
    ingestPicked(
      ((fn: (prev: never[]) => never[]) => chips.push(...(fn([]) as unknown as never[]))) as never,
      (path, name) => paths.push([path, name]),
      ((fn: (cur: string) => string) => texts.push(fn(""))) as never,
      items,
    );
    return { chips, paths, texts };
  };

  it("图片带字节 → chip（模型才看得见图）", () => {
    const { chips, paths } = run([picked({ name: "shot.png", isImage: true, base64: "AAAA" })]);
    expect(chips).toHaveLength(1);
    expect(paths).toEqual([]);
  });

  it("普通文件（不管多大）→ 上传 chip，走壳按路径上传，不是 @ 引用", () => {
    const { paths, texts } = run([picked({ name: "离职证明_金杭滨.pdf" })]);
    expect(paths).toEqual([["/tmp/离职证明_金杭滨.pdf", "离职证明_金杭滨.pdf"]]);
    expect(texts.join("")).not.toContain("@");
  });

  it("文件夹 → @ 引用（没有字节可传，只能给路径）", () => {
    const { chips, paths, texts } = run([picked({ name: "docs", isDir: true })]);
    expect(chips).toEqual([]);
    expect(paths).toEqual([]);
    expect(texts.join("")).toContain("@/tmp/docs/");
  });
});
