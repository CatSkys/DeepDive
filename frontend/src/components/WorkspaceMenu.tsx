import { useEffect, useRef } from "react";
import { Folder, Link2 } from "lucide-react";
import type { WorkspaceView } from "../types";
import { revealPath } from "../host";
import { useT } from "../i18n";

// 项目（工作区）的"文件夹"类动作：打开项目文件夹 / 复制路径。
//
// 三处入口共用**同一份动作项**（hero 项目胶囊与底部空间格的右键菜单、侧栏工作区行
// 的 ⋯ 菜单）——它们指的都是同一个项目文件夹，各写一份会立刻分叉（措辞/能力对不上）。
// 菜单容器沿用全站的 .ctx-menu/.ctx-item 配方。

/** 打开项目文件夹 / 复制路径。`onDone` 由容器给（关菜单）。 */
export function WorkspaceFolderItems({ ws, onDone }: { ws: WorkspaceView; onDone: () => void }) {
  const { t } = useT();
  return (
    <>
      <div className="ctx-item" onClick={() => { revealPath(ws.path); onDone(); }}>
        <Folder size={13} /> {t("在 Finder 中打开")}
      </div>
      <div className="ctx-item" onClick={() => {
        // 与会话右键菜单同一条复制路径（navigator.clipboard）。手机浏览器上
        // 可能因权限静默失败——那是既有限制，不在本轮扩大范围。
        void navigator.clipboard.writeText(ws.path).catch(() => void 0);
        onDone();
      }}>
        <Link2 size={13} /> {t("复制路径")}
      </div>
    </>
  );
}

/** 项目元素的右键菜单（胶囊 / 空间格）：位置取右键坐标。
 *  click-outside 关闭与 ModelMenu/ProjectMenu 同款（mousedown + ref）。 */
export function WorkspaceMenu({ ws, x, y, onClose }: { ws: WorkspaceView; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ top: y, left: Math.min(x, window.innerWidth - 220) }}
      onClick={(e) => e.stopPropagation()}
    >
      <WorkspaceFolderItems ws={ws} onDone={onClose} />
    </div>
  );
}
