import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { Check, MoreHorizontal } from "lucide-react";
import rowsCss from "../settings/SettingsRows.module.css";

/** Global shared controls (settings sections + hero preset picker): monochrome
 *  toggle and custom dropdown (portaled so the options scroller cannot clip
 *  it). Styles: settings/SettingsRows.module.css. */

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`${rowsCss.toggle}${on ? ` ${rowsCss.on}` : ""}`}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    />
  );
}

export interface DropdownOption {
  v: string;
  label: string;
  /** 次要说明：有则菜单行转两行富行（label + desc），触发钮不带。 */
  description?: string;
  icon?: LucideIcon;
  /** 任意节点图标（如提供方品牌 svg）：Lucide 组件装不下时用。 */
  iconNode?: ReactNode;
  /** 危险项：当前值命中时触发钮以热点橙提示（如 完全访问）。 */
  danger?: boolean;
}

/** 下拉选择器。variant="bare"＝行内文字触发器（无描边无底色）；
 *  block＝占满容器宽度（表单里与输入框同宽的一行）。 */
export function Dropdown({ options, value, onChange, variant, block }: { options: DropdownOption[]; value: string; onChange: (v: string) => void; variant?: "bare"; block?: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // portal 菜单也在"内部"：否则 mousedown 命中选项时先被判为外部点击而
  // 卸载菜单，click 永远到不了选项（用户报告的下拉"看得到点不了"）。
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const toggle = () => {
    if (!open) {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 4, left: r.left, minWidth: r.width });
    }
    setOpen((o) => !o);
  };
  const current = options.find((o) => o.v === value);
  const rich = options.some((o) => o.description);
  const menuHeight = options.reduce((h, o) => h + (o.description ? 48 : 30), 0) + 24;
  // Portaled to <body> with fixed positioning: the options scroller clips
  // absolutely-positioned menus (user report). 长清单（模型提供方 38 项）菜单
  // 高过视口时压限高度内滚——否则首项被顶出屏幕外无法选择。
  const menu = open && pos && createPortal(
    <div
      ref={menuRef}
      className={rowsCss.ddMenu}
      role="listbox"
      style={{
        position: "fixed",
        // space below the trigger, else flip above it。翻转分支必须显式
        // top:"auto"——.ddMenu 类自带 top:calc(100%+4px)（absolute 时代
        // 遗留），不清掉会与 bottom 双约束把菜单压成视口外细条（用户报告
        // 的"提供商没法点"）。
        ...(window.innerHeight - pos.top > menuHeight
          ? { top: pos.top, bottom: "auto" }
          : { top: "auto", bottom: window.innerHeight - pos.top + 4 }),
        right: "auto",
        left: Math.max(8, Math.min(pos.left, window.innerWidth - Math.max(pos.minWidth, rich ? 272 : 0) - 12)),
        minWidth: Math.max(pos.minWidth, rich ? 272 : 0),
        maxHeight: Math.max(180, (window.innerHeight - pos.top > menuHeight
          ? window.innerHeight - pos.top
          : pos.top) - 24),
        overflowY: "auto",
      }}
    >
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.v}
            type="button"
            className={rowsCss.ddItem}
            data-rich={o.description ? "true" : undefined}
            onClick={() => {
              setOpen(false);
              if (o.v !== value) onChange(o.v);
            }}
          >
            {Icon && <Icon size={15} className={rowsCss.ddItemIcon} />}
            {o.iconNode && <span className={rowsCss.ddItemIcon}>{o.iconNode}</span>}
            <span className={rowsCss.ddItemMain}>
              <span>{o.label}</span>
              {o.description && <span className={rowsCss.ddItemDesc}>{o.description}</span>}
            </span>
            {o.v === value && <Check size={14} className={rowsCss.ddCheck} />}
          </button>
        );
      })}
    </div>,
    document.body,
  );
  return (
    <div className={`${rowsCss.dd}${variant === "bare" ? ` ${rowsCss.ddBare}` : ""}${block ? ` ${rowsCss.ddBlock}` : ""}`} ref={rootRef}>
      <button ref={triggerRef} type="button" className={rowsCss.ddTrigger} data-danger={current?.danger ? "true" : undefined} onClick={toggle}>
        {current?.icon && <current.icon size={14} className={rowsCss.ddTriggerIcon} />}
        {current?.iconNode && <span className={rowsCss.ddTriggerIcon}>{current.iconNode}</span>}
        <span>{current?.label ?? value}</span>
        <ChevronDown size={14} className={rowsCss.ddChevron} />
      </button>
      {menu}
    </div>
  );
}

/** 一行动作菜单项：点一下执行一个动作（与 Dropdown 不同——没有"当前值"）。 */
export interface RowMenuItem {
  v: string;
  label: string;
  icon?: LucideIcon;
  /** 危险动作（如卸载）：文字走 danger 语义色。 */
  danger?: boolean;
}

const ROW_MENU_WIDTH = 176;

/** 行内「…」动作菜单：触发钮是图标，菜单从它右下方展开、右对齐（靠右的行不会溢出）。
 *  样式复用 Dropdown 的 `.ddMenu` / `.ddItem`（同一套菜单观感）。 */
export function RowMenu({ items, onSelect, label }: {
  items: RowMenuItem[];
  onSelect: (v: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      // portal 菜单挂 body，但点击沿 React 树冒泡——判定必须两个子树都算"内部"
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) {
        const menuHeight = items.length * 30 + 12;
        // 下方放不下就向上翻；翻转分支必须显式给 top:"auto"，否则与 .ddMenu 类自带的
        // top 双约束把菜单压成细条（PITFALLS §1.7）
        const top = window.innerHeight - r.bottom > menuHeight ? r.bottom + 4 : Math.max(8, r.top - menuHeight - 4);
        setPos({ top, left: Math.max(8, Math.min(r.right - ROW_MENU_WIDTH, window.innerWidth - ROW_MENU_WIDTH - 8)) });
      }
    }
    setOpen((o) => !o);
  };

  return (
    <div className={rowsCss.dd} ref={rootRef}>
      <button ref={triggerRef} type="button" className={rowsCss.ddIconTrigger} aria-label={label} onClick={toggle}>
        <MoreHorizontal size={15} />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className={rowsCss.ddMenu}
          role="menu"
          style={{
            position: "fixed",
            top: pos.top,
            bottom: "auto",
            left: pos.left,
            right: "auto",
            minWidth: ROW_MENU_WIDTH,
          }}
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.v}
                type="button"
                role="menuitem"
                className={rowsCss.ddItem}
                data-danger={item.danger ? "true" : undefined}
                onClick={() => { setOpen(false); onSelect(item.v); }}
              >
                {Icon && <Icon size={15} className={rowsCss.ddItemIcon} />}
                <span className={rowsCss.ddItemMain}>
                  <span>{item.label}</span>
                </span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
