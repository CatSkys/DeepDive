import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { Check, MoreHorizontal } from "lucide-react";
import { useBrowserPopup } from "../sidebar-right/useBrowserPopup";
import rowsCss from "../settings/SettingsRows.module.css";
import { GlassLayer } from "./GlassLayer";
import { measuringStyle, placeFloating, useFloatingBox } from "./floatingPlacement";

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
 *  block＝占满容器宽度（表单里与输入框同宽的一行）。value 可缺省（思考强度
 *  跟随引擎默认档时无确定值），此时触发器显示 options 里命中的当前项或空。 */
export function Dropdown({ options, value, onChange, variant, block }: { options: DropdownOption[]; value: string | undefined; onChange: (v: string) => void; variant?: "bare"; block?: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // portal 菜单也在"内部"：否则 mousedown 命中选项时先被判为外部点击而
  // 卸载菜单，click 永远到不了选项（用户报告的下拉"看得到点不了"）。
  const menuRef = useRef<HTMLDivElement>(null);
  // 触发器自身的宽：菜单的最小宽按它定（量菜单之前就得知道，见 floatingPlacement）
  const [triggerWidth, setTriggerWidth] = useState(0);
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
    if (!open) setTriggerWidth(triggerRef.current?.getBoundingClientRect().width ?? 0);
    setOpen((o) => !o);
  };
  const current = options.find((o) => o.v === value);
  const rich = options.some((o) => o.description);
  // Portaled to <body> with fixed positioning: the options scroller clips
  // absolutely-positioned menus (user report). 长清单（模型提供方 38 项）菜单
  // 高过视口时压限高度内滚——否则首项被顶出屏幕外无法选择。
  //
  // 落位交给 floatingPlacement：菜单宽由内容撑（≈88），拿触发器宽（≈51）去夹右缘会让
  // 菜单探出屏幕——所以这里"先量后落位"（useFloatingBox），限高由它按实际余量给。
  const box = useFloatingBox(open, triggerRef, menuRef);
  const minWidth = Math.max(triggerWidth, rich ? 272 : 0);
  const placement = box === null ? null : placeFloating(box.anchor, { width: box.width, height: box.height, inset: box.inset });
  const menu = open && createPortal(
    <div
      ref={menuRef}
      className={rowsCss.ddMenu}
      role="listbox"
      style={placement === null
        // 还没量到尺寸：不可见地渲一帧（几何见 measuringStyle，别手写）
        ? measuringStyle(minWidth)
        : {
          position: "fixed",
          top: placement.top,
          bottom: "auto",
          right: "auto",
          left: placement.left,
          minWidth,
          maxHeight: placement.maxHeight,
          overflowY: "auto",
        }}
    >
      <GlassLayer />
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
export function RowMenu({ items, onSelect, label, nativePopup = false }: {
  items: RowMenuItem[];
  onSelect: (v: string) => void;
  label: string;
  nativePopup?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const popupTarget = useBrowserPopup(nativePopup && open, () => setOpen(false));
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

  // 菜单贴触发钮的右下、右边对齐（靠右的行不会溢出）：落位算术与 Dropdown 同一份
  const box = useFloatingBox(open, triggerRef, menuRef);
  const placement = box === null ? null : placeFloating(box.anchor, { width: box.width, height: box.height, inset: box.inset }, { align: "right" });

  return (
    <div className={rowsCss.dd} ref={rootRef}>
      <button ref={triggerRef} type="button" className={rowsCss.ddIconTrigger} aria-label={label} onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal size={15} />
      </button>
      {open && (!nativePopup || popupTarget) && createPortal(
        <div
          ref={menuRef}
          className={rowsCss.ddMenu}
          role="menu"
          style={placement === null
            // 还没量到尺寸：不可见地渲一帧（几何见 measuringStyle，别手写）
            ? measuringStyle(ROW_MENU_WIDTH)
            : {
              position: "fixed",
              top: placement.top,
              bottom: "auto",
              left: placement.left,
              right: "auto",
              minWidth: ROW_MENU_WIDTH,
              maxHeight: placement.maxHeight,
              overflowY: "auto",
            }}
        >
          <GlassLayer />
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
        nativePopup ? popupTarget! : document.body,
      )}
    </div>
  );
}
