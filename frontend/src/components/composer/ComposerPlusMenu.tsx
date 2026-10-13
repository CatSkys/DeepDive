// composer ＋ 的二级菜单（照参考图）：截图 / 上传文件 / 添加文件夹… / 提及…
// 只做呈现与选择；各项的落点由 Composer 编排（截图与附件摄入、@ 提及走输入框）。
// 样式复用 @/ 命令菜单那一套（.composer-menu / .menu-row），位置由 .composer-anchor 决定。

import { AtSign, Camera, FolderPlus, Paperclip } from "lucide-react";
import { useT } from "../../i18n";

export type PlusAction = "screenshot" | "files" | "folders" | "mention";

const ROWS: Array<{ id: PlusAction; icon: typeof Camera; zh: string; en: string }> = [
  { id: "screenshot", icon: Camera, zh: "截图", en: "Take a screenshot" },
  { id: "files", icon: Paperclip, zh: "上传文件", en: "Upload files" },
  { id: "folders", icon: FolderPlus, zh: "添加文件夹…", en: "Add a folder…" },
  { id: "mention", icon: AtSign, zh: "提及文件、对话或工具…", en: "Mention a file, chat, or tool…" },
];

export function ComposerPlusMenu({ onPick }: { onPick: (action: PlusAction) => void }) {
  const { tt } = useT();
  return (
    <div className="composer-menu">
      <span className="menu-noise" aria-hidden />
      <div className="menu-list">
        {ROWS.map((row) => (
          <button
            key={row.id}
            type="button"
            className="menu-row"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(row.id)}
          >
            <row.icon size={15} />
            <span className="label">{tt(row.zh, row.en)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
