// 思考强度（推理档位）控件：输入框右侧那颗「档位 ⌄」胶囊 + 轻量弹层。
//
// 只管两件事：呈现当前档位与弹层开合、⇧⌘E 循环（键位在 keybinds.ts，派发在
// useAppKeybinds）。档位数据与提交由调用方经 EffortFace 传入——真会话读会话的
// modelSelection 投影，草稿页读 store.draftModel；本组件不去猜这两条路。
//
// 弹层往哪开由 floatingPlacement 定（下方放不下才翻上方）：输入框钉在窗口底部，所以
// 常态是向上开、窗口矮到上方也放不下时改为向下并在余量内内滚，任何情况都不出视口。
// 样式复用设置族的紧凑菜单配方（SettingsRows 的 ddMenu/ddItem，与设置页下拉同一套观感）。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { comboFor } from "../../keybinds";
import { useT } from "../../i18n";
import { useStore } from "../../store";
import { DD_EVENTS } from "../../events";
import rowsCss from "../../settings/SettingsRows.module.css";
import { GlassLayer } from "../GlassLayer";
import { measuringStyle, placeFloating, useFloatingBox } from "../floatingPlacement";

/** 输入框上的思考强度面：档位表 + 当前生效档（undefined = 引擎没报生效档）。 */
export interface EffortFace {
  levels: Array<{ id: string; name: string }>;
  value: string | undefined;
  pick: (id: string) => void | Promise<void>;
}

/** 当前显示哪一档：引擎报了生效档就用它；**没有就取档位表里最高的一档**。
 *
 *  口径（用户 2026-10-10 定稿）：有推荐值就显示推荐值，没有则**任何情况下都不许
 *  显示为空**——最高档就是那一档。levels 由引擎按 pi-ai 的档位序 off<minimal<…<max
 *  排好，末项即最高。空胶囊在这里是"看起来坏了"，不是"如实"。
 *  引擎侧同时被要求补齐事实源（见 PITFALLS §7.11），那条兜底是第二道保险，不是常态。
 *  导出给会话设置面板的「思考强度」行复用（同一显示口径，勿各写一套）。 */
export function shownLevel(id: string | undefined, levels: Array<{ id: string; name: string }>): string | undefined {
  if (id !== undefined && levels.some((l) => l.id === id)) return id;
  return levels[levels.length - 1]?.id;
}

/** 档位显示：直接用引擎给的名称（Off/Low/High/Max…）。**没有"Default"这一档**——
 *  用户 2026-10-09 定稿"是啥档位就显示啥档位"。导出给面板命令中心的选择页复用
 *  （根行右边那颗当前档位名与选择页里的行名同一口径，勿各写一套）。 */
export function effortDisplayName(id: string | undefined, levels: Array<{ id: string; name: string }>): string {
  return id === undefined ? "" : (levels.find((l) => l.id === id)?.name ?? id);
}

const MENU_MIN_WIDTH = 148;

export function EffortPicker({ levels, value, pick }: EffortFace) {
  const { t } = useT();
  const store = useStore();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // 弹层尺寸只有量了才知道（宽由档位名撑），所以先渲一帧不可见的再落位
  const box = useFloatingBox(open, triggerRef, menuRef);
  const placement = box === null ? null : placeFloating(box.anchor, { width: box.width, height: box.height, inset: box.inset });

  const shown = shownLevel(value, levels);

  // 快捷键循环只挂一次：face 每次渲染都是新对象，闭包会拿到旧档位（流式期渲染更频繁），
  // 所以镜像到 ref、触发时读现值。
  const face = useRef<EffortFace>({ levels, value, pick });
  face.current = { levels, value, pick };
  useEffect(() => {
    const onCycle = () => {
      const f = face.current;
      if (f.levels.length === 0) return;
      // 从**显示的那档**起算（没有显示档时从最低档起），保证循环的起点与眼睛看到的
      // 是同一档——否则看着显示 Max、按一下跳到最低档，像倒退。
      const idx = f.levels.findIndex((l) => l.id === shownLevel(f.value, f.levels));
      const next = f.levels[(idx + 1 + f.levels.length) % f.levels.length];
      if (next) void f.pick(next.id);
    };
    window.addEventListener(DD_EVENTS.cycleEffort, onCycle);
    return () => window.removeEventListener(DD_EVENTS.cycleEffort, onCycle);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      // 弹层挂 body，点击沿 React 树冒泡——触发器与弹层都算"内部"，否则点选项时
      // mousedown 先判外部把菜单卸掉，click 永远到不了选项。
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => setOpen((v) => !v);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="composer-effort"
        data-open={open ? "true" : "false"}
        aria-haspopup="menu"
        data-tip={t("思考强度")}
        data-tip-keys={comboFor("cycle-effort", store.keybinds)}
        onClick={toggle}
      >
        <span className="composer-effort-label">{effortDisplayName(shown, levels)}</span>
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className={rowsCss.ddMenu}
          role="menu"
          style={placement === null
            // 还没量到尺寸：不可见地渲一帧（几何见 measuringStyle，别手写）
            ? measuringStyle(MENU_MIN_WIDTH)
            : {
              position: "fixed",
              top: placement.top,
              bottom: "auto",
              left: placement.left,
              right: "auto",
              minWidth: MENU_MIN_WIDTH,
              maxHeight: placement.maxHeight,
              overflowY: "auto",
            }}
        >
          <GlassLayer />
          {levels.map((level) => (
            <button
              key={level.id}
              type="button"
              role="menuitemradio"
              aria-checked={level.id === shown}
              className={rowsCss.ddItem}
              // 点选不夺焦点：光标留在输入框里，与 @ // 候选行同一口径
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false);
                // 点当前显示的那档（引擎没报生效档时可能是兜底显示的最高档）不提交
                if (level.id !== shown) void pick(level.id);
              }}
            >
              <span>{level.name}</span>
              {level.id === shown && <Check size={14} className={rowsCss.ddCheck} />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
