// 交付文件卡（官方 ui-deliverables 语义移植）：present 工具声明的文件在轮尾呈现。
// 图片直接出缩略图（点击进应用内预览），其余出名称 chip（右键菜单可交给默认应用 /
// Finder，锚点与产物 chip 同款 data-file-ctx）。只负责呈现：相对路径按 root 解析，
// 路径策略由调用方给（会话 cwd）。

import { t } from "../i18n";
import { openPath } from "../host";
import { fileUrlOf, renderersOf } from "../components/preview/previewModel";
import { basename } from "./format";
import type { PresentedFile } from "../types";

export function PresentedFiles({ files, root, onPreview }: {
  files: PresentedFile[];
  /** 相对路径的解析根（引擎口径：会话工作目录）。 */
  root?: string;
  onPreview?: (path: string) => void;
}) {
  if (files.length === 0) return null;
  const abs = (p: string) => (p.startsWith("/") || !root ? p : `${root}/${p}`);
  const open = (path: string) => (onPreview ? onPreview(path) : openPath(path));
  return (
    <div className="delivered">
      <span className="delivered-label">{t("交付")}</span>
      <div className="delivered-row">
        {files.map((f) => {
          const path = abs(f.path);
          // 图片（png/jpg/gif/webp/svg…）以内联缩略图呈现，其余是名称 chip
          const image = renderersOf(path).includes("image");
          return (
            <button
              key={f.path}
              type="button"
              className={image ? "delivered-card delivered-image" : "delivered-card"}
              title={f.description ?? f.path}
              data-file-ctx={path}
              aria-label={f.description ?? basename(path)}
              onClick={() => open(path)}
            >
              {image ? (
                <img className="delivered-thumb" src={fileUrlOf(path)} alt={f.description ?? basename(path)} loading="lazy" />
              ) : (
                <>
                  <span className="delivered-name">{basename(path)}</span>
                  {f.description && <span className="delivered-desc">{f.description}</span>}
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
