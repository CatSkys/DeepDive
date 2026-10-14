// 迷你面板的悬浮**命令中心**（照参考图那类命令面板）：一张浮在页面之上的卡片——
// 顶部搜索框，下面按模式给行（历史 = 会话列表，设置 = 设置行/选择页）。**页面本身不换**：
// 卡片之外还是原来的草稿/会话页，Esc、点卡片外、或再点那颗钮收回。
// 卡片**居中浮在面板窗口中间**（不是从按钮下拉出来的一条）：位置/尺寸由本组件排（壳按它
// 报上来的矩形铺那块原生玻璃），**材质与铬件不在网页里**——真 Liquid Glass、圆角、浮起投影、
// 进场淡入都是原生层给的（`WindowGlassView` 的 .card 档 + QuickPanelController），
// 网页只画内容。所以这里没有背景/模糊/投影/描边，只有布局与那一条发丝线。
// 键盘：↑↓ 走行、Enter 激活、Esc 先回上一层（设置的选择页）/清空搜索，空搜索再按才关。
// 行件在 MiniHistoryRows / MiniSettingsRows，本文件只管卡片框架、搜索与键盘派发。
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { X } from "lucide-react";
import { useT } from "../i18n";
import { onHostEvent } from "../host";
import { isKeybind } from "../keybinds";
import { useStore } from "../store";
import { MiniHistoryRows } from "./MiniHistoryRows";
import { MiniSettingsRows } from "./MiniSettingsRows";

export type MiniOverlayMode = "history" | "settings";

/** 行件的键盘钩子：**返回 true = 已消费**（框架不再走自己的 Esc/其它语义）。
 *  事件的现实形态有两处：搜索框（React 事件）与整页监听（DOM 事件）——只用到 `key` 与
 *  `preventDefault`，所以按这个最小形状收口。 */
export type KeyHandler = (e: { key: string; preventDefault(): void }) => boolean;

/** 注册一份行件的键盘处理，**返回注销**——清理由注册方自己拿回去。
 *
 *  为什么必须这样：这里原先是"父层在换模式时把 keyRef 置空"，而 React 的 effect 顺序是
 *  **子先父后**，父层那条会紧跟在子层的注册之后跑、把它抹掉。于是卡片**刚打开时** keyRef
 *  是 null，方向键/回车/Esc 整片失灵，要等下一次任意重渲染（比如打一个字）才回来。
 *  表现就是设置脸里按 Esc 不返回上层、直接把整张卡片收掉（用户 2026-10-14 报"Raycast 可以
 *  ESC 返回，我们也要可以，因为没有返回按钮"——返回行删掉之后 Esc 是唯一的回路）。
 *
 *  注册方**只注册一次、读实时状态**（行件里那份 stateRef 镜像）：重注册挂上的是 effect，
 *  而 effect 的 flush 晚于渲染一个任务——点一行翻页后立刻按键，拿到的还是上一份处理器，
 *  一样是"Esc 收卡"而不是"返回上层"（2026-10-14 复现，见 MiniSettingsRows 注释）。 */
export type RegisterKeys = (handler: KeyHandler) => () => void;

export function MiniCommandCenter({
  mode,
  sessionId,
  onClose,
}: {
  mode: MiniOverlayMode;
  /** 设置模式的行集按脸给：有会话用会话那一支，否则草稿那一支。 */
  sessionId: string | null;
  onClose: () => void;
}) {
  const { t } = useT();
  const store = useStore();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  // 卡片不画材质：它底下那块原生玻璃由壳摆（矩形由面板页算并推给壳，见 miniCardAnchor.ts），
  // 见 theme.css 该条注释与 WindowGlassView 的 .floating 档。
  /** 行件的键盘处理：每次渲染注册一份最新的（行件里的状态闭包才不会过期）。 */
  const keyRef = useRef<KeyHandler | null>(null);
  const registerKeys: RegisterKeys = useCallback((handler) => {
    keyRef.current = handler;
    return () => {
      if (keyRef.current === handler) keyRef.current = null;
    };
  }, []);

  // 打开即聚焦搜索框（壳的 quickPanelFocus 只推给会话输入框，这里自己拿焦点）
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 键盘两条路，共用同一个 keyRef（行件优先）：
  //  · 搜索框里的键走它自己的 onKeyDown（`onSearchKeys`）——那是 React 事件；
  //  · 卡片其余地方的键走这张整页表。**两条都要**：两张脸现在都有搜索框，而壳开卡时把
  //    第一响应者交给这块 webview，焦点可能在任一处。所以整页表**跳过搜索框那一路**，
  //    免得同一个 Esc 被处理两次（一次返回上层、一次把卡收掉）。
  //  Esc：先问行件（设置脸里它负责"退回根行"），没人认领才收卡——返回行删掉之后这条是
  //  唯一的回路。⌘K 是这一页的开关（与面板页那颗 ⌘ 钮、与卡片外的 ⌘K 面板同一个键位），
  //  卡片拿着键盘时由这里收；"打开"那一半在面板页。
  //  **认下的键一律 preventDefault**：WKWebView 里页面不管的 Esc 会沿 responder chain
  //  变成窗口的 cancelOperation（实测：不 preventDefault 就到达窗口、preventDefault 就
  //  停住）——页面既然把它当命令使了，就不能再放它出去（同一条纪律见 onSearchKeys 与
  //  MiniSettingsRows 的行件）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target === inputRef.current) return;
      if (isKeybind(e, "command-palette", store.keybinds)) {
        e.preventDefault();
        onClose();
        return;
      }
      if (keyRef.current?.(e)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, store.keybinds]);

  // 壳转来的 Esc（`miniCCEscape`）：面板页拿着键盘时它不代卡页收卡，只把这一次按键转过来
  // （见 MiniPanelApp 那条）——这里与真实的 Esc 走同一条路：先问行件（设置脸里它负责
  // "退回根行"），没人认领才收卡。
  useEffect(() => onHostEvent((cmd) => {
    if (cmd !== "miniCCEscape") return;
    if (keyRef.current?.({ key: "Escape", preventDefault: () => {} })) return;
    onClose();
  }), [onClose]);

  // 点卡片外收掉。两类不算"外"：卡片自己，以及卡片上弹出的右键菜单（.ctx-menu——
  // 历史行的「更多」/右键菜单挂在 body，点它不该把卡片一起收掉）。
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (cardRef.current?.contains(target)) return;
      if (target.closest(".ctx-menu")) return;
      if (!target.closest(".app.mini-panel")) return;
      onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  const onSearchKeys = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // 行件优先（设置的选择页借 Esc 回上一层）；它不管的才落到框架的搜索/关闭语义
    if (keyRef.current?.(e)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (query !== "") setQuery("");
      else onClose();
    }
  };

  return (
    <div className="mini-cc" ref={cardRef} role="dialog" aria-label={mode === "history" ? t("会话历史") : t("命令中心")}>
      <label className="mini-cc-search">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKeys}
          placeholder={mode === "history" ? t("搜索会话…") : t("搜索命令…")}
          aria-label={mode === "history" ? t("搜索会话…") : t("搜索命令…")}
        />
        {query !== "" && (
          <button
            type="button"
            className="mini-cc-clear"
            aria-label={t("清空")}
            data-tip={t("清空")}
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <X size={13} />
          </button>
        )}
      </label>
      <div className="mini-cc-body">
        {mode === "history"
          ? <MiniHistoryRows query={query} registerKeys={registerKeys} />
          : <MiniSettingsRows sessionId={sessionId} registerKeys={registerKeys} query={query} />}
      </div>
    </div>
  );
}
