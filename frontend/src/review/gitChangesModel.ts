// 审查面板 wire 边界的收窄（铁律 5：外部输入只在边界处校验）。壳侧 git 载荷
// 字段漂移时按缺省值落，不让 undefined 进 UI 运算；不合法的条目整条丢弃，
// 不用半个字段去渲染一行。只管收窄，不管取数与渲染。

import type { ReviewChange, ReviewChangeKind, ReviewChanges, ReviewDiff, ReviewDiffKind } from "./types";

const CHANGE_KINDS: ReviewChangeKind[] = ["modified", "added", "deleted", "renamed", "untracked", "conflicted"];
const DIFF_KINDS: ReviewDiffKind[] = ["patch", "untracked", "binary", "truncated", "unavailable"];

const NO_CHANGES: ReviewChanges = { repo: false, branch: "", files: [] };
const NO_DIFF: ReviewDiff = { kind: "unavailable", patch: "", content: "" };

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** 单条改动：path 与 kind 缺一不可（没有它们这一行无从渲染），计数与 binary 缺省落 0/false。 */
function narrowChange(v: unknown): ReviewChange | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const path = str(o.path);
  if (!path) return null;
  const kind = CHANGE_KINDS.find((k) => k === o.kind);
  if (!kind) return null;
  return {
    path,
    originalPath: str(o.originalPath),
    kind,
    added: num(o.added),
    removed: num(o.removed),
    binary: o.binary === true,
  };
}

/** 改动清单。repo 为假即"没有 git 数据"（非仓库 / git 不可用 / 超时），files 走空表。 */
export function narrowReviewChanges(payload: unknown): ReviewChanges {
  const o = payload as Record<string, unknown> | null;
  if (!o || o.repo !== true) return NO_CHANGES;
  const raw = Array.isArray(o.files) ? o.files : [];
  return { repo: true, branch: str(o.branch), files: raw.map(narrowChange).filter((c): c is ReviewChange => c !== null) };
}

/** 单文件 diff。kind 决定带哪些正文：patch 与 untracked 都要工作树全文
 * （untracked 靠它把每行标成新增，patch 靠它补出 patch 里没有的未改动行）；
 * binary/truncated/unavailable 三档都不带正文——半截 patch 解析出来是错的，宁可没有。 */
export function narrowReviewDiff(payload: unknown): ReviewDiff {
  const o = payload as Record<string, unknown> | null;
  if (!o) return NO_DIFF;
  const kind = DIFF_KINDS.find((k) => k === o.kind) ?? "unavailable";
  const withBody = kind === "patch" || kind === "untracked";
  return { kind, patch: kind === "patch" ? str(o.patch) : "", content: withBody ? str(o.content) : "" };
}
