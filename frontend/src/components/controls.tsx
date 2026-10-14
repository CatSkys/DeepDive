import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Check, MoreHorizontal } from "lucide-react";
import { useBrowserPopup } from "../sidebar-right/useBrowserPopup";
import rowsCss from "../settings/SettingsRows.module.css";
import { Popover } from "./Popover";

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
  /** 触发器的宽：菜单至少与它同宽（沿用旧口径）。开的时候量一次。 */
  const [anchorW, setAnchorW] = useState(0);
  const toggle = () => {
    if (!open) setAnchorW(triggerRef.current?.getBoundingClientRect().width ?? 0);
    setOpen((o) => !o);
  };
  const current = options.find((o) => o.v === value);
  const rich = options.some((o) => o.description);
  // 长清单（模型提供方 38 项）压限高度内滚——否则首项被顶出屏幕外无法选择。
  const menu = (
    <Popover
      open={open}
      anchor={triggerRef}
      onClose={() => setOpen(false)}
      sideOffset={4}
      className={rowsCss.ddMenu}
      role="listbox"
      style={{ minWidth: Math.max(anchorW, rich ? 272 : 0), overflowY: "auto" }}
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
    </Popover>
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const toggle = () => setOpen((o) => !o);

  return (
    <div className={rowsCss.dd} ref={rootRef}>
      <button ref={triggerRef} type="button" className={rowsCss.ddIconTrigger} aria-label={label} onClick={toggle}>
        <MoreHorizontal size={15} />
      </button>
      {(!nativePopup || popupTarget) && (
        <Popover
          open={open}
          anchor={triggerRef}
          onClose={() => setOpen(false)}
          sideOffset={4}
          align="end"
          width={ROW_MENU_WIDTH}
          height={items.length * 30 + 12}
          className={rowsCss.ddMenu}
          role="menu"
          container={nativePopup ? popupTarget : undefined}
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
        </Popover>
      )}
    </div>
  );
}
