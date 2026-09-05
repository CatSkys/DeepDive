import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Folder, Plus, Search } from "lucide-react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { pickNewWorkspace } from "./workspacePicker";

// Hero 项目切换菜单（新会话页点项目名弹出）：搜索 + 项目列表（文件夹图标 +
// 名称，当前项目右侧打勾）+ 底部「新建项目」。不做参考图里的「不在项目中
// 工作」——本客户端每个会话必属一个工作空间，引擎无此语义。
export function ProjectMenu({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const { t, tt } = useT();
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // click-outside 关闭（与 ModelMenu 同款 mousedown 语义）
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);

  // 搜索过滤：标题或路径命中
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return store.workspaces;
    return store.workspaces.filter((w) => w.title.toLowerCase().includes(q) || w.path.toLowerCase().includes(q));
  }, [store.workspaces, query]);

  return (
    <div className="ws-menu" ref={ref}>
      <div className="ws-menu-search">
        <Search size={13} />
        <input autoFocus placeholder={t("搜索项目")} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="ws-menu-body">
        {list.map((w) => {
          const active = w.workspaceId === store.activeWorkspaceId;
          return (
            <button
              key={w.workspaceId}
              className="ws-menu-row"
              data-tip={w.path}
              onClick={() => {
                store.switchWorkspace(w.workspaceId, { keepDraft: true });
                onClose();
              }}
            >
              <Folder size={15} />
              <span className="name">{w.title}</span>
              {active && <Check size={15} className="check" />}
            </button>
          );
        })}
        {list.length === 0 && <div className="ws-menu-empty">{t("没有匹配的项目")}</div>}
      </div>
      <div className="ws-menu-sep" />
      <div className="ws-menu-foot">
        <button
          className="ws-menu-row"
          onClick={() => {
            pickNewWorkspace(
              !!window.webkit?.messageHandlers?.deepdiveHost,
              t("输入要添加为工作空间的文件夹绝对路径："),
              
              (p) => void store.createWorkspace(p).then((r) => {
                if (r.error) alert(tt("添加工作空间失败：{m}", "Add workspace failed: {m}", { m: r.error }));
              }),
            );
            onClose();
          }}
        >
          <Plus size={15} />
          <span className="name">{t("新建项目")}</span>
        </button>
      </div>
    </div>
  );
}
